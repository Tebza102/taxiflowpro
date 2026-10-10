import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// Guards for HOSTED operator procedures (scripts/hosted/*). Nothing here has
// been run against a hosted project. Rules:
// * --target <project-ref> is required and must equal the ref in SUPABASE_URL
//   (https://<ref>.supabase.co); local or other hosts are refused.
// * Credentials come only from --env-file, which must be OUTSIDE the repository,
//   and must be a NEW secret key (sb_secret_...). Legacy service_role keys are
//   refused (they are deactivated at cutover). Keys are never printed.
// * Dry run by default. --apply additionally requires an interactive terminal
//   and typing the project ref exactly.

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REF = /^[a-z0-9]{20}$/;

const option = (argv, name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

export const parseEnvFile = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );

export const resolveHostedTarget = ({ argv, repoRoot = REPO_ROOT, readFile = (file) => readFileSync(file, "utf8"), fileExists = existsSync }) => {
  const ref = option(argv, "target");
  const envFile = option(argv, "env-file");
  if (!ref || !REF.test(ref)) throw new Error("--target <project-ref> (20 lowercase letters/digits) is required.");
  if (!envFile) throw new Error("--env-file <path outside the repository> is required.");
  const resolved = path.resolve(envFile);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("The env file must be outside the repository.");
  if (!fileExists(resolved)) throw new Error("The env file does not exist.");
  const env = parseEnvFile(readFile(resolved));
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("The env file must define SUPABASE_URL and SUPABASE_SECRET_KEY.");
  if (!key.startsWith("sb_secret_")) throw new Error("SUPABASE_SECRET_KEY must be a new secret key (sb_secret_...); legacy service_role keys are refused.");
  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL.");
  }
  if (!new URL(url).protocol.startsWith("https")) throw new Error("SUPABASE_URL must use https.");
  if (host !== `${ref}.supabase.co`) throw new Error(`SUPABASE_URL host ${host} does not match --target ${ref}.`);
  return { ref, url, key, apply: argv.includes("--apply") };
};

export const describeTarget = (target, operation) =>
  [`Target project : ${target.ref} (${new URL(target.url).host})`, `Operation      : ${operation}`, `Mode           : ${target.apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`].join("\n");

// Interactive confirmation for --apply. Refuses without a terminal.
export const confirmApply = async (target, { input = process.stdin, output = process.stdout } = {}) => {
  if (!target.apply) return false;
  if (!input.isTTY) throw new Error("--apply needs an interactive terminal for confirmation.");
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Type the project ref (${target.ref}) to apply: `);
    if (answer.trim() !== target.ref) throw new Error("Confirmation did not match; nothing was written.");
    return true;
  } finally {
    rl.close();
  }
};
