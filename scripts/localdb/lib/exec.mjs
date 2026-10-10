import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPOSE_VOLUME,
  DEFAULT_LOCAL_WORKDIR,
  LOCAL_API_PORT,
  LOCAL_DB_PORT,
  LOCAL_MAIL_PORT,
  LOCAL_PROJECT_ID,
  assertLocalDockerContext,
  assertLocalStatus,
  assertLocalWorkdir,
  assertMarkerRow,
  assertPublishedBindings,
  assertWindowsListeners,
} from "./localTarget.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const WORKDIR = process.env.TAXIFLOW_LOCALDB_WORKDIR || DEFAULT_LOCAL_WORKDIR;
export const COMPOSE_DIR = path.join(WORKDIR, "compose");
export const COMPOSE_FILE = path.join(COMPOSE_DIR, "docker-compose.yml");
export const ENV_FILE = path.join(COMPOSE_DIR, ".env");
export const DB_CONTAINER = "taxiflow_localdb_db";

export const run = (command, args, { input, allowFailure = false, timeout = 600_000 } = {}) => {
  const result = spawnSync(command, args, { input, encoding: "utf8", maxBuffer: 64 << 20, timeout });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (exit ${result.status}): ${(result.stderr || result.stdout || "").trim().slice(-600)}`);
  }
  return result;
};

// --- Local secrets (generated once, kept in the workdir only) -----------------

const base64url = (value) => Buffer.from(value).toString("base64url");

export const signLocalJwt = (payload, secret) => {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
};

export const generateLocalSecrets = () => {
  const jwtSecret = randomBytes(32).toString("hex");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 5 * 365 * 24 * 3600;
  return {
    POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
    JWT_SECRET: jwtSecret,
    ANON_KEY: signLocalJwt({ iss: "taxiflow-localdb", role: "anon", iat, exp }, jwtSecret),
    SERVICE_ROLE_KEY: signLocalJwt({ iss: "taxiflow-localdb", role: "service_role", iat, exp }, jwtSecret),
  };
};

export const readLocalEnv = () => {
  if (!existsSync(ENV_FILE)) throw new Error(`Missing ${ENV_FILE}; run: node scripts/localdb/setup.mjs prepare`);
  return Object.fromEntries(
    readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
};

// --- Docker / Compose -----------------------------------------------------------

export const assertDockerIsLocal = () => {
  const context = run("docker", ["context", "show"]).stdout.trim();
  assertLocalDockerContext({ context, dockerHost: process.env.DOCKER_HOST });
  return context;
};

export const compose = (args, options) => {
  assertLocalWorkdir(WORKDIR, { repoRoot: REPO_ROOT });
  assertDockerIsLocal();
  return run("docker", ["compose", "-p", LOCAL_PROJECT_ID, "-f", COMPOSE_FILE, "--env-file", ENV_FILE, ...args], options);
};

export const publishedBindingLines = () =>
  run("docker", ["ps", "--filter", `label=com.docker.compose.project=${LOCAL_PROJECT_ID}`, "--format", "{{.Names}}|{{.Ports}}"])
    .stdout.trim()
    .split(/\r?\n/)
    .filter(Boolean);

// Windows TCP listeners owned by Docker Desktop's port forwarders.
export const dockerWindowsListeners = () => {
  const ps = [
    "$ids = @(Get-Process -Name 'com.docker.backend','wslrelay' -ErrorAction SilentlyContinue | ForEach-Object Id);",
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } |",
    "ForEach-Object { '{0}|{1}|{2}' -f $_.LocalAddress, $_.LocalPort, (Get-Process -Id $_.OwningProcess).ProcessName }",
  ].join(" ");
  return run("powershell", ["-NoProfile", "-Command", ps])
    .stdout.trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [address, port, process] = line.trim().split("|");
      return { address, port: Number(port), process };
    });
};

// Stops (down, keeping the volume) and throws if any published service is
// reachable beyond loopback.
export const assertLoopbackOnlyOrStop = () => {
  try {
    const bindings = assertPublishedBindings(publishedBindingLines());
    const listeners = assertWindowsListeners(dockerWindowsListeners());
    return { bindings, listeners };
  } catch (error) {
    compose(["down"], { allowFailure: true });
    throw new Error(`STOPPED the local stack: ${error.message}`);
  }
};

export const localStatus = () => {
  assertLocalWorkdir(WORKDIR, { repoRoot: REPO_ROOT });
  const env = readLocalEnv();
  const status = {
    API_URL: `http://127.0.0.1:${LOCAL_API_PORT}`,
    DB_URL: `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:${LOCAL_DB_PORT}/postgres`,
    MAIL_URL: `http://127.0.0.1:${LOCAL_MAIL_PORT}`,
    ANON_KEY: env.ANON_KEY,
    SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
  };
  return { ...status, ...assertLocalStatus(status) };
};

// SQL runs only inside the local database container, as postgres, via stdin.
export const psql = (sql, { allowFailure = false } = {}) => {
  assertDockerIsLocal();
  return run("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], {
    input: sql,
    allowFailure,
  });
};

export const markerRows = () =>
  psql("select id from taxiflow_local.instance;", { allowFailure: true })
    .stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const assertLocalDatabase = () => {
  const status = localStatus();
  assertMarkerRow(markerRows());
  return status;
};

export const removeComposeVolume = () => {
  const labels = run("docker", ["volume", "inspect", COMPOSE_VOLUME, "--format", '{{index .Labels "com.docker.compose.project"}}'], {
    allowFailure: true,
  });
  if (labels.status !== 0) return false;
  if (labels.stdout.trim() !== LOCAL_PROJECT_ID) throw new Error(`Volume ${COMPOSE_VOLUME} is not owned by the local Compose project; refusing to remove it.`);
  run("docker", ["volume", "rm", COMPOSE_VOLUME]);
  return true;
};
