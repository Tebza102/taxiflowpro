import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

import { LOGBOOK_FIELDS } from "../../src/lib/logbookContract.js";
import { describeZodError, extractionSchema } from "./logbookSchema.js";
import { createHttpError } from "./tenantAuth.js";

// Server-side only. The model id (LOGBOOK_VISION_MODEL) and the key
// (ANTHROPIC_API_KEY) are read from the server environment at call time and are
// never sent to, or accepted from, the browser.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

// The file type is decided from the bytes, not from the name or claimed type.
export const sniffImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp" && HEIC_BRANDS.includes(buffer.subarray(8, 12).toString("latin1"))) return "image/heic";
  return null;
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// Decodes and checks one uploaded page: size first, then real image type.
// HEIC is converted to JPEG. Returns { buffer, mediaType, sha256, byteSize }.
export const prepareLogbookImage = async ({ dataBase64, filename } = {}) => {
  const label = filename ? `"${String(filename).slice(0, 80)}"` : "The file";
  const raw = String(dataBase64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!raw || !BASE64.test(raw)) throw createHttpError(400, `${label} is not valid base64 image data.`);
  // 4 base64 characters carry 3 bytes: refuse before decoding anything oversized.
  if (Math.floor((raw.length * 3) / 4) - 2 > MAX_IMAGE_BYTES) throw createHttpError(413, `${label} is larger than 10 MB.`);
  const original = Buffer.from(raw, "base64");
  if (original.length > MAX_IMAGE_BYTES) throw createHttpError(413, `${label} is larger than 10 MB.`);
  const type = sniffImageType(original);
  if (!type) throw createHttpError(415, `${label} is not a JPG, PNG or HEIC image.`);
  // The hash is of the bytes as uploaded, so the same photo is recognised again.
  const sha256 = createHash("sha256").update(original).digest("hex");
  if (type !== "image/heic") return { buffer: original, mediaType: type, sha256, byteSize: original.length };
  try {
    const { default: convert } = await import("heic-convert");
    const converted = Buffer.from(await convert({ buffer: original, format: "JPEG", quality: 0.9 }));
    return { buffer: converted, mediaType: "image/jpeg", sha256, byteSize: converted.length };
  } catch {
    throw createHttpError(415, `${label} could not be converted from HEIC. Save it as a JPG and try again.`);
  }
};

const fieldList = LOGBOOK_FIELDS.map(({ key, kind }) => `"${key}" (${kind === "amount" ? "number, rand" : kind === "date" ? "YYYY-MM-DD text" : "text"})`).join(", ");

export const LOGBOOK_SYSTEM_PROMPT = `You transcribe photographed pages of a South African minibus-taxi driver logbook into JSON for a bookkeeping review queue. A person checks every value afterwards against the photo, so an honest "I cannot read this" is far more useful than a plausible guess.

Return one JSON object and nothing else (no prose, no code fence):
{"rows": [ROW, ...], "pageNote": text or null}

Each ROW describes one logbook line (one driver's day on one vehicle) and has exactly these keys: ${fieldList}.
Each key holds {"value": ..., "confidence": "high" | "medium" | "low", "note": text or null}.

What the fields mean:
- date: the day of the line. Use the year only if it is written on the page (on the line or in a page heading).
- vehicleRegistration: the vehicle's number plate as written.
- driverName: the driver's name as written.
- revenue: the day's takings.
- fuel: diesel or petrol. wash: vehicle wash. marshalFees: rank or queue marshal fees. otherExpenses: any other expense on the line, added together.
- banked: the amount banked or handed in.

Rules:
- Never guess. If a value is smudged, cut off, overwritten, too blurred, or you are choosing between readings, return "value": null with "confidence": "low" and say in "note" what you can see (for example "ink blot over the amount" or "could be 450 or 480").
- "high" means every character is clearly legible. "medium" means you read it but one character or the handwriting leaves some doubt; say why in "note". "low" is for null values only.
- A cell left empty or struck through with a dash means none: return 0 for amounts with "high" confidence. Unreadable writing is null, not 0.
- Amounts are plain numbers in rand (1250.5, not "R1 250,50"). Do not calculate, correct or reconcile figures; transcribe what is written even if the sums look wrong.
- If the day and month are legible but no year is written anywhere on the page, return "value": null for date and put what you read in "note".
- Skip heading, total and blank lines. If the page is not a logbook or has no readable lines, return "rows": [] and explain in "pageNote".`;

const USER_INSTRUCTION = "Transcribe this logbook page.";

let testClient = null;
// Tests only (synthetic stub; never reachable from a request). Refused in production.
export const setLogbookVisionClientForTests = (client) => {
  if (process.env.NODE_ENV === "production") throw new Error("The vision test client cannot be set in production.");
  testClient = client;
};

export const logbookVisionModel = () => {
  const model = String(process.env.LOGBOOK_VISION_MODEL ?? "").trim();
  if (!model) throw createHttpError(503, "Logbook photo reading is not set up on this server (LOGBOOK_VISION_MODEL).");
  return model;
};

const visionClient = () => {
  if (testClient) return testClient;
  const apiKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) throw createHttpError(503, "Logbook photo reading is not set up on this server (ANTHROPIC_API_KEY).");
  return new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 });
};

// Reads the model's reply as strict JSON. Returns { ok, data } or { ok:false, reason }.
export const parseExtractionReply = (message) => {
  if (message?.stop_reason === "refusal") return { ok: false, fatal: true, reason: "The model declined to read this page." };
  if (message?.stop_reason === "max_tokens") return { ok: false, reason: "The reply was cut off before the JSON was complete." };
  let reply = (message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("").trim();
  // A code fence around the whole object is unwrapped (lossless); any other text is refused.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(reply);
  if (fenced) reply = fenced[1].trim();
  if (!reply) return { ok: false, reason: "The reply contained no text." };
  let json;
  try {
    json = JSON.parse(reply);
  } catch {
    return { ok: false, reason: "The reply was not valid JSON (it must be one JSON object with no other text)." };
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: `The JSON did not match the required shape: ${describeZodError(parsed.error)}` };
  return { ok: true, data: parsed.data };
};

// One page -> validated rows. An invalid reply is rejected and the model is asked
// once more with the reason; a second invalid reply fails the request (502).
export const extractLogbookPage = async ({ buffer, mediaType }, { client = visionClient(), model = logbookVisionModel() } = {}) => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
        { type: "text", text: USER_INSTRUCTION },
      ],
    },
  ];
  let lastReason = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let message;
    try {
      message = await client.messages.create({ model, max_tokens: 16000, system: LOGBOOK_SYSTEM_PROMPT, messages });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw createHttpError(503, "Logbook photo reading is not set up correctly on this server.");
      }
      if (error instanceof Anthropic.NotFoundError) throw createHttpError(503, "The configured logbook vision model is not available.");
      if (error instanceof Anthropic.RateLimitError) throw createHttpError(503, "Logbook photo reading is busy. Try again in a minute.");
      if (error instanceof Anthropic.BadRequestError) throw createHttpError(502, "The vision model could not accept this page.");
      if (error instanceof Anthropic.APIError) throw createHttpError(502, "The vision model could not be reached. Try again.");
      throw error;
    }
    const result = parseExtractionReply(message);
    if (result.ok) return { rows: result.data.rows, pageNote: result.data.pageNote ?? null, attempts: attempt, model };
    lastReason = result.reason;
    if (result.fatal) break;
    // Keep the model's own turn (including any thinking blocks) unchanged and say what was wrong.
    if (message.content?.length) messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: `That reply was rejected: ${result.reason} Send the complete answer again as one JSON object in the required shape, with no other text.` });
  }
  throw createHttpError(502, `The page could not be read into valid rows. ${lastReason}`);
};
