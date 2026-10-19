import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Fail-closed guards for the isolated LOCAL TaxiFlow database (Compose stack).
// Every local script calls these before any start, reset, SQL, seed, export or
// restore. Pure functions; I/O lives in exec.mjs.

// Two fixed local profiles, selected with TAXIFLOW_LOCALDB_PROFILE:
//   default  the long-lived stack (rehearsal and manual work)
//   test     a separate, disposable stack for destructive/resetting suites
// Each has its own Compose project, volume, workdir, container names and
// loopback ports; every guard below applies unchanged to whichever is active.
// Any other profile name is refused.
export const LOCAL_PROFILES = Object.freeze({
  default: Object.freeze({
    name: "default",
    projectId: "taxiflow-localdb",
    workdir: "C:\\Users\\appri\\taxiflow-localdb",
    apiPort: 54321,
    dbPort: 54322,
    mailPort: 54324,
    volume: "taxiflow_localdb_compose_db",
    containerPrefix: "taxiflow_localdb",
    appPort: 5175,
  }),
  test: Object.freeze({
    name: "test",
    projectId: "taxiflow-localdb-test",
    workdir: "C:\\Users\\appri\\taxiflow-localdb-test",
    apiPort: 55321,
    dbPort: 55322,
    mailPort: 55324,
    volume: "taxiflow_localdb_test_db",
    containerPrefix: "taxiflow_localdb_test",
    appPort: 5176,
  }),
});

export const resolveLocalProfile = (value) => {
  const name = String(value ?? "").trim() || "default";
  const profile = LOCAL_PROFILES[name];
  if (!profile || !Object.hasOwn(LOCAL_PROFILES, name)) {
    throw new LocalTargetError(`Unknown local profile "${name}" (expected ${Object.keys(LOCAL_PROFILES).join(" or ")}).`);
  }
  return profile;
};

export class LocalTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalTargetError";
  }
}

export const ACTIVE_PROFILE = resolveLocalProfile(process.env.TAXIFLOW_LOCALDB_PROFILE);
export const LOCAL_PROJECT_ID = ACTIVE_PROFILE.projectId;
// The marker means "a dedicated local TaxiFlow database"; both profiles carry it.
export const LOCAL_MARKER_ID = "taxiflow-localdb-isolated";
export const DEFAULT_LOCAL_WORKDIR = ACTIVE_PROFILE.workdir;
export const LOCAL_API_PORT = ACTIVE_PROFILE.apiPort;
export const LOCAL_DB_PORT = ACTIVE_PROFILE.dbPort;
export const LOCAL_MAIL_PORT = ACTIVE_PROFILE.mailPort;
export const COMPOSE_VOLUME = ACTIVE_PROFILE.volume;
export const CONTAINER_PREFIX = ACTIVE_PROFILE.containerPrefix;
export const CLI_DISABLED_SENTINEL = "TAXIFLOW_SUPABASE_CLI_DISABLED";
// Intentionally invalid TOML: any supabase CLI command in the workdir fails to parse it.
export const CLI_DISABLED_CONFIG = `# ${"TAXIFLOW_SUPABASE_CLI_DISABLED"}
# The Supabase CLI must not run in this folder: it publishes ports on all network
# interfaces. The local stack runs from ../compose via the TaxiFlow repo:
#   node scripts/localdb/setup.mjs start|reset|stop
[[[ intentionally invalid TOML so every supabase CLI command fails here ]]]
`;
// The hosted TaxiFlow project; its ref must never appear in a local target.
export const LIVE_PROJECT_REF = "vfxftviwteypasredjgm";

// The only published ports allowed for the active profile's project, each loopback-only.
export const bindingsFor = (profile) =>
  Object.freeze([
    `127.0.0.1:${profile.apiPort}->8000/tcp`,
    `127.0.0.1:${profile.dbPort}->5432/tcp`,
    `127.0.0.1:${profile.mailPort}->8025/tcp`,
  ]);
export const ALLOWED_BINDINGS = bindingsFor(ACTIVE_PROFILE);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const FORBIDDEN_CLI_ARGS = ["--linked", "--db-url", "--project-ref"];
const LOCAL_DOCKER_CONTEXTS = new Set(["desktop-linux", "default"]);

const refuse = (message) => {
  throw new LocalTargetError(message);
};

// kind: "api" (http, port 54321) or "db" (postgresql, port 54322).
export const assertLocalUrl = (value, { kind }) => {
  const raw = String(value ?? "").trim();
  if (!raw) refuse(`No ${kind} URL to check.`);
  if (raw.toLowerCase().includes(LIVE_PROJECT_REF)) refuse(`The ${kind} target references the live TaxiFlow project.`);

  let url;
  try {
    url = new URL(raw);
  } catch {
    refuse(`The ${kind} target is not a valid URL.`);
  }

  const expected =
    kind === "api"
      ? { protocols: ["http:"], port: LOCAL_API_PORT }
      : { protocols: ["postgresql:", "postgres:"], port: LOCAL_DB_PORT };
  if (!expected.protocols.includes(url.protocol)) refuse(`The ${kind} target must use ${expected.protocols.join(" or ")}.`);
  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) refuse(`The ${kind} target host ${host} is not local (127.0.0.1/localhost).`);
  if (Number(url.port) !== expected.port) refuse(`The ${kind} target port ${url.port || "(default)"} is not the local ${expected.port}.`);
  return { host, port: expected.port };
};

// Kept for any future Supabase CLI use: hosted-target flags are always refused.
export const assertSafeCliArgs = (args) => {
  const bad = args.find((arg) => FORBIDDEN_CLI_ARGS.some((flag) => String(arg).startsWith(flag)));
  if (bad) refuse(`Refusing Supabase CLI argument ${bad}: local tooling only ever targets the local stack.`);
  return args;
};

// The workdir must hold the Compose stack, sit outside the repo, never be linked
// to a hosted project, and NOT contain an active Supabase CLI config.toml - the
// CLI publishes on all interfaces, so a CLI start must be impossible here.
export const assertLocalWorkdir = (workdir, { repoRoot } = {}) => {
  const resolved = path.resolve(workdir);
  if (repoRoot) {
    const relative = path.relative(path.resolve(repoRoot), resolved);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      refuse("The local workdir must be outside the TaxiFlow repository.");
    }
  }
  const composePath = path.join(resolved, "compose", "docker-compose.yml");
  if (!existsSync(composePath)) refuse(`No compose/docker-compose.yml in ${resolved}.`);
  const projectName = readFileSync(composePath, "utf8").match(/^name:\s*(\S+)/m)?.[1];
  if (projectName !== LOCAL_PROJECT_ID) refuse(`Compose project name is "${projectName}", expected "${LOCAL_PROJECT_ID}".`);
  // The CLI falls back to defaults when config.toml is merely absent, so the
  // workdir must hold the deliberately invalid sentinel config that makes every
  // CLI command fail at parse time.
  const cliConfig = path.join(resolved, "supabase", "config.toml");
  if (!existsSync(cliConfig) || !readFileSync(cliConfig, "utf8").includes(CLI_DISABLED_SENTINEL)) {
    refuse("supabase/config.toml must be the CLI-disabled sentinel: otherwise the Supabase CLI could start a duplicate stack on all interfaces.");
  }
  if (existsSync(path.join(resolved, "supabase", ".temp", "project-ref"))) {
    refuse("This workdir is linked to a hosted project (supabase/.temp/project-ref exists).");
  }
  return resolved;
};

export const assertLocalDockerContext = ({ context, dockerHost }) => {
  if (String(dockerHost ?? "").trim()) refuse("DOCKER_HOST is set; local tooling only uses the local Docker Desktop engine.");
  if (!LOCAL_DOCKER_CONTEXTS.has(String(context ?? "").trim())) refuse(`Docker context "${context}" is not the local engine.`);
};

export const assertLocalStatus = (status) => {
  const apiUrl = status?.API_URL ?? status?.apiUrl;
  const dbUrl = status?.DB_URL ?? status?.dbUrl;
  assertLocalUrl(apiUrl, { kind: "api" });
  assertLocalUrl(dbUrl, { kind: "db" });
  return { apiUrl, dbUrl };
};

export const assertMarkerRow = (rows) => {
  if (!Array.isArray(rows) || !rows.includes(LOCAL_MARKER_ID)) {
    refuse("The local marker row is missing: this is not the dedicated local TaxiFlow database.");
  }
};

// lines: "container|ports" from `docker ps --format "{{.Names}}|{{.Ports}}"` for the
// local project. Every published mapping must be one of ALLOWED_BINDINGS, and all
// three must be present.
export const assertPublishedBindings = (lines) => {
  const published = lines.flatMap((line) =>
    String(line)
      .split("|")
      .slice(1)
      .join("|")
      .split(",")
      .map((mapping) => mapping.trim())
      .filter((mapping) => mapping.includes("->")),
  );
  const unexpected = published.filter((mapping) => !ALLOWED_BINDINGS.includes(mapping));
  if (unexpected.length) refuse(`Unexpected or wildcard published ports: ${unexpected.join(", ")}`);
  const missing = ALLOWED_BINDINGS.filter((mapping) => !published.includes(mapping));
  if (missing.length) refuse(`Expected loopback ports not published: ${missing.join(", ")}`);
  return published;
};

// listeners: [{ address, port, process }] Windows TCP listeners owned by the
// Docker Desktop port forwarders (com.docker.backend, wslrelay). All must be
// loopback and on a port of one of the fixed local profiles (the forwarders are
// machine-wide, so both stacks' listeners are visible from either profile).
export const ALL_PROFILE_PORTS = Object.freeze(
  Object.values(LOCAL_PROFILES).flatMap((profile) => [profile.apiPort, profile.dbPort, profile.mailPort]),
);
export const assertWindowsListeners = (listeners) => {
  const allowedPorts = new Set(ALL_PROFILE_PORTS);
  const bad = listeners.filter(
    (entry) => !LOOPBACK_ADDRESSES.has(String(entry.address)) || !allowedPorts.has(Number(entry.port)),
  );
  if (bad.length) {
    refuse(`Docker listeners reachable beyond loopback or on extra ports: ${bad.map((e) => `${e.address}:${e.port} (${e.process})`).join(", ")}`);
  }
  return listeners;
};

// The checked-in Compose template is the default profile. Another profile gets
// the same file with its own project name, container names, volume and
// loopback ports; nothing of the default profile may remain in it.
export const renderComposeForProfile = (template, profile = ACTIVE_PROFILE) => {
  const base = LOCAL_PROFILES.default;
  if (profile.name === base.name) return template;
  const rendered = template
    .replace(/^name:\s*taxiflow-localdb\s*$/m, `name: ${profile.projectId}`)
    .replaceAll(`container_name: ${base.containerPrefix}_`, `container_name: ${profile.containerPrefix}_`)
    .replaceAll(`name: ${base.volume}`, `name: ${profile.volume}`)
    .replaceAll(`127.0.0.1:${base.apiPort}:`, `127.0.0.1:${profile.apiPort}:`)
    .replaceAll(`127.0.0.1:${base.dbPort}:`, `127.0.0.1:${profile.dbPort}:`)
    .replaceAll(`127.0.0.1:${base.mailPort}:`, `127.0.0.1:${profile.mailPort}:`)
    .replaceAll(`http://127.0.0.1:${base.apiPort}`, `http://127.0.0.1:${profile.apiPort}`);
  const leftovers = [
    new RegExp(`^name:\\s*${base.projectId}\\s*$`, "m"),
    new RegExp(`container_name: ${base.containerPrefix}_(db|auth|rest|kong|mail)\\b`),
    new RegExp(base.volume),
    new RegExp(`\\b(${base.apiPort}|${base.dbPort}|${base.mailPort})\\b`),
  ].filter((pattern) => pattern.test(rendered));
  if (leftovers.length) refuse(`The ${profile.name} Compose file still references the default profile (${leftovers.join(", ")}).`);
  if (!rendered.includes(`name: ${profile.projectId}`)) refuse(`The ${profile.name} Compose file has no project name.`);
  return rendered;
};

// --- Canonical manifests --------------------------------------------------------

export const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const sha256 = (value) => createHash("sha256").update(stableStringify(value)).digest("hex");

export const snapshotManifest = (snapshot) => ({
  sha256: sha256(snapshot),
  keys: Object.keys(snapshot ?? {}).sort(),
  counts: Object.fromEntries(
    Object.keys(snapshot ?? {})
      .sort()
      .map((key) => [key, Array.isArray(snapshot[key]) ? snapshot[key].length : "object"]),
  ),
});

// Auth identity manifest: which accounts exist (id + email) and their identities,
// independent of row order and of volatile fields.
export const authManifest = ({ users = [], identities = [] }) => ({
  users: users.length,
  identities: identities.length,
  usersSha256: sha256(users.map((user) => [user.id, user.email]).sort()),
  identitiesSha256: sha256(identities.map((identity) => [identity.user_id, identity.provider, identity.provider_id]).sort()),
});
