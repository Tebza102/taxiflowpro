import { createHash } from "node:crypto";

// Pre-write and post-run safeguards for the live Preview UAT gate. Everything here
// is pure or takes its I/O (fetch, workspace reads) as arguments, so every rule
// can be proven with mocks before the runner is ever pointed at a real deployment.
//
// Nothing in this module writes anywhere, and nothing it returns contains a
// token, key or password.

export const VERCEL_TEAM_ID = "team_Kp55is5BgPnNjwWlgCDb4SYB";
export const VERCEL_PROJECT_ID = "prj_vYaxObYXR8imyMKRr951yLJ0XAh7";
const VERCEL_API_ORIGIN = "https://api.vercel.com";

// Hosts that are, or have been, production for this project. The live list is
// also read from the Vercel project before every run (see verifyDeploymentTarget);
// this static list only guarantees these are refused even if that read omits them.
export const KNOWN_PRODUCTION_HOSTS = Object.freeze([
  "taxiflowpro.vercel.app",
  "taxiflowpro-apprigate.vercel.app",
  "taxiflowpro-git-main-apprigate.vercel.app",
  "taxiflow.apprigate.com",
  "taxiflowpro-vq1gbf579-apprigate.vercel.app",
]);

// An immutable deployment URL: <project>-<9 char id>-<team>.vercel.app. Branch
// aliases (taxiflowpro-git-<branch>-apprigate.vercel.app), project aliases and
// custom domains never match, because they move between deployments.
const IMMUTABLE_DEPLOYMENT_HOST = /^taxiflowpro-[a-z0-9]{9}-apprigate\.vercel\.app$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export const UAT_FIXTURE_PREFIX = "UAT-";

export class UatSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "UatSafetyError";
  }
}

const refuse = (message) => {
  throw new UatSafetyError(message);
};

const text = (value) => String(value ?? "").trim();
const lowerHost = (value) => text(value).toLowerCase().replace(/\.$/, "");

export const parseHostList = (value) =>
  text(value)
    .split(",")
    .map(lowerHost)
    .filter(Boolean);

// --- Target -------------------------------------------------------------------

export const assertSafePreviewTarget = ({
  previewUrl,
  expectedHost,
  expectedCommitSha,
  extraProductionHosts = [],
}) => {
  let url;
  try {
    url = new URL(text(previewUrl));
  } catch {
    refuse("PREVIEW_URL is not a valid URL.");
  }

  if (url.protocol !== "https:") refuse("PREVIEW_URL must use https.");
  if (url.username || url.password) refuse("PREVIEW_URL must not contain credentials.");
  if (url.port) refuse("PREVIEW_URL must not specify a port.");
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    refuse("PREVIEW_URL must be the bare deployment origin (no path, query or fragment).");
  }

  const host = lowerHost(url.hostname);
  const productionHosts = new Set([...KNOWN_PRODUCTION_HOSTS, ...extraProductionHosts.map(lowerHost)]);

  if (productionHosts.has(host)) {
    refuse(`PREVIEW_URL host ${host} is a production host or alias. Refusing to run UAT against it.`);
  }
  if (!IMMUTABLE_DEPLOYMENT_HOST.test(host)) {
    refuse(
      `PREVIEW_URL host ${host} is not an immutable taxiflowpro deployment URL. Branch aliases, ` +
        "project aliases and custom domains can point at production, so they are refused.",
    );
  }
  if (!expectedHost) {
    refuse("UAT_EXPECTED_DEPLOYMENT_HOST is required: the exact verified Preview host.");
  }
  if (lowerHost(expectedHost) !== host) {
    refuse(`PREVIEW_URL host ${host} does not match UAT_EXPECTED_DEPLOYMENT_HOST.`);
  }
  if (!COMMIT_SHA.test(text(expectedCommitSha))) {
    refuse("UAT_EXPECTED_COMMIT_SHA must be the full 40-character commit SHA of the verified Preview.");
  }

  return { host, origin: `https://${host}` };
};

// Confirms with the Vercel API (not a naming convention) that the host is a READY
// Preview deployment of this project at the expected commit, and that it is not
// the production deployment or any of its aliases. Fails closed on any missing
// field, non-OK response or network error. The token is sent only to the Vercel
// API origin and is never included in an error message.
export const verifyDeploymentTarget = async ({
  host,
  expectedCommitSha,
  token,
  fetchImpl = globalThis.fetch,
  teamId = VERCEL_TEAM_ID,
  projectId = VERCEL_PROJECT_ID,
  extraProductionHosts = [],
}) => {
  if (!text(token)) {
    refuse(
      "VERCEL_TOKEN is required to verify the Preview deployment's target and commit before any write.",
    );
  }

  const getJson = async (pathAndQuery, what) => {
    let response;
    try {
      response = await fetchImpl(`${VERCEL_API_ORIGIN}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      refuse(`Could not reach the Vercel API to read the ${what}.`);
    }
    if (!response?.ok) {
      refuse(`Vercel API refused the ${what} read (HTTP ${response?.status ?? "unknown"}).`);
    }
    return response.json();
  };

  const project = await getJson(
    `/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(teamId)}`,
    "project",
  );
  const production = project?.targets?.production;
  if (!production?.id) {
    refuse("Could not identify the current production deployment from the Vercel project.");
  }

  const productionHosts = new Set(
    [
      ...KNOWN_PRODUCTION_HOSTS,
      ...extraProductionHosts,
      production.url,
      ...(Array.isArray(production.alias) ? production.alias : []),
      ...(Array.isArray(project.alias) ? project.alias.map((entry) => entry?.domain ?? entry) : []),
    ]
      .filter(Boolean)
      .map(lowerHost),
  );

  if (productionHosts.has(lowerHost(host))) {
    refuse(`${host} is the production deployment or one of its aliases.`);
  }

  const deployment = await getJson(
    `/v13/deployments/${encodeURIComponent(host)}?teamId=${encodeURIComponent(teamId)}`,
    "deployment",
  );

  if (deployment?.projectId !== projectId) {
    refuse(`${host} does not belong to the expected Vercel project.`);
  }
  if (deployment.id === production.id) {
    refuse(`${host} is the current production deployment.`);
  }
  if (deployment.target === "production") {
    refuse(`${host} is a production-target deployment.`);
  }
  if (lowerHost(deployment.url) !== lowerHost(host)) {
    refuse(`${host} is not the deployment's own immutable URL.`);
  }
  if (deployment.readyState !== "READY") {
    refuse(`${host} is not READY (state: ${deployment.readyState ?? "unknown"}).`);
  }
  const deployedSha = text(deployment.meta?.githubCommitSha);
  if (deployedSha !== text(expectedCommitSha)) {
    refuse(`${host} was built from a different commit than UAT_EXPECTED_COMMIT_SHA.`);
  }
  const aliases = (Array.isArray(deployment.alias) ? deployment.alias : []).map(lowerHost);
  const productionAlias = aliases.find((alias) => productionHosts.has(alias));
  if (productionAlias) {
    refuse(`${host} is aliased to production host ${productionAlias}.`);
  }

  return {
    deploymentId: deployment.id,
    commitSha: deployedSha,
    target: deployment.target ?? "preview",
    productionDeploymentId: production.id,
  };
};

// --- Fixture ------------------------------------------------------------------

const asArray = (value) => (Array.isArray(value) ? value : []);

const VEHICLE_REFERENCE_COLLECTIONS = [
  "financeTransactions",
  "dailyCashUps",
  "defects",
  "serviceSchedule",
  "documents",
  "verificationQueue",
];

const referencesVehicle = (record, vehicle) => {
  const values = [record?.vehicleId, record?.vehicle, record?.vehicleRegistration, record?.registration]
    .map(text)
    .filter(Boolean);
  return values.includes(text(vehicle.id)) || values.includes(text(vehicle.registration));
};

const isUatTagged = (record) => JSON.stringify(record ?? {}).includes(UAT_FIXTURE_PREFIX);

// The UAT finance record must land on a vehicle Tebogo created for testing: named
// with the UAT- prefix, not archived, not assigned to a driver, and not referenced
// by any non-UAT record. Selection is always by explicit id, never by position.
export const assertDisposableVehicleFixture = (snapshot, { vehicleId }) => {
  const id = text(vehicleId);
  if (!id) {
    refuse(
      "UAT_FIXTURE_VEHICLE_ID is required: the id of a disposable test vehicle whose " +
        `registration starts with "${UAT_FIXTURE_PREFIX}".`,
    );
  }

  const vehicle = asArray(snapshot?.vehicles).find((entry) => text(entry?.id) === id);
  if (!vehicle) refuse(`Fixture vehicle ${id} does not exist in the live workspace.`);

  if (!text(vehicle.registration).startsWith(UAT_FIXTURE_PREFIX)) {
    refuse(
      `Fixture vehicle ${id} is not marked disposable (registration must start with "${UAT_FIXTURE_PREFIX}").`,
    );
  }
  if (vehicle.archivedAt || text(vehicle.status).toLowerCase() === "archived") {
    refuse(`Fixture vehicle ${id} is archived.`);
  }
  if (text(vehicle.assignedDriverId)) {
    refuse(`Fixture vehicle ${id} is assigned to a driver; a disposable fixture must be unassigned.`);
  }

  for (const collection of VEHICLE_REFERENCE_COLLECTIONS) {
    const realReference = asArray(snapshot?.[collection]).find(
      (record) => referencesVehicle(record, vehicle) && !isUatTagged(record),
    );
    if (realReference) {
      refuse(`Fixture vehicle ${id} is referenced by a non-UAT ${collection} record, so it is not disposable.`);
    }
  }

  return { id, registration: text(vehicle.registration) };
};

// --- Write inventory and residue ----------------------------------------------

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const digest = (value) => createHash("sha256").update(stableStringify(value)).digest("hex");

const recordKey = (record) =>
  text(record?.id) ||
  text(record?.staffId) ||
  text(record?.email).toLowerCase() ||
  `hash:${digest(record)}`;

// Content-free fingerprint: per-collection record keys mapped to content hashes.
// Only keys and hashes are kept, so it is safe to hold in memory and to report.
export const fingerprintWorkspace = (snapshot) => {
  const collections = {};
  for (const [name, value] of Object.entries(snapshot ?? {})) {
    if (Array.isArray(value)) {
      const records = new Map();
      for (const record of value) records.set(recordKey(record), digest(record));
      collections[name] = records;
    } else {
      collections[name] = new Map([["(value)", digest(value)]]);
    }
  }
  return collections;
};

export const diffFingerprints = (before, after) => {
  const changes = [];
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const collection of [...names].sort()) {
    const left = before?.[collection] ?? new Map();
    const right = after?.[collection] ?? new Map();
    for (const [id, hash] of right) {
      if (!left.has(id)) changes.push({ collection, id, kind: "added" });
      else if (left.get(id) !== hash) changes.push({ collection, id, kind: "changed" });
    }
    for (const id of left.keys()) {
      if (!right.has(id)) changes.push({ collection, id, kind: "removed" });
    }
  }
  return changes;
};

const findRecord = (snapshot, collection, id) => {
  const value = snapshot?.[collection];
  return Array.isArray(value) ? value.find((record) => recordKey(record) === id) ?? null : null;
};

const mentionsRun = (record, markers) => {
  const serialized = JSON.stringify(record ?? {}).toLowerCase();
  return markers.some((marker) => marker && serialized.includes(marker.toLowerCase()));
};

// Sorts every workspace difference into:
//   retained   - expected, permanent run traces (append-only audit entries that
//                mention the run, and changes to the disposable fixture vehicle)
//   residue    - run-related records that should have been cleaned up
//   unexpected - anything not attributable to this run (another writer, or a
//                side effect the UAT did not declare); the run must stop/fail
export const classifyWorkspaceChanges = ({
  before,
  after,
  beforeSnapshot,
  afterSnapshot,
  runTag,
  disposableEmail,
  fixtureVehicleId,
  fixtureRegistration,
}) => {
  const markers = [runTag, disposableEmail, fixtureRegistration].map(text).filter(Boolean);
  const result = { retained: [], residue: [], unexpected: [] };

  for (const change of diffFingerprints(before, after)) {
    const record =
      findRecord(afterSnapshot, change.collection, change.id) ??
      findRecord(beforeSnapshot, change.collection, change.id);
    const related = record ? mentionsRun(record, markers) : false;

    if (change.collection === "auditTrail" && change.kind === "added" && related) {
      result.retained.push(change);
    } else if (change.collection === "vehicles" && change.id === text(fixtureVehicleId) && change.kind === "changed") {
      result.retained.push(change);
    } else if (change.kind !== "removed" && related) {
      result.residue.push(change);
    } else {
      result.unexpected.push(change);
    }
  }

  return result;
};

// Auth users are compared by id only. Any id other than the disposable account is
// unexpected; the disposable account still existing after cleanup is residue.
export const classifyAuthUserChanges = ({ beforeIds, afterIds, disposableUserId }) => {
  const before = new Set(beforeIds);
  const after = new Set(afterIds);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  return {
    residue: added.filter((id) => id === disposableUserId),
    unexpected: [...added.filter((id) => id !== disposableUserId), ...removed],
  };
};

export const summarizeChanges = (changes) =>
  changes.map(({ collection, id, kind }) => `${collection}:${kind}:${id}`);

export const BANKED_STEP_STATUS = "NOT TESTED — unsupported on the shared live workspace";
