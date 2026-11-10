import { createHash } from "node:crypto";
import { z } from "zod";

import {
  LOGBOOK_CONFIDENCE,
  LOGBOOK_FIELDS,
  logbookRowIdentity,
  normalizeLogbookFields,
} from "../../src/lib/logbookContract.js";

// Strict shapes for everything that enters the logbook pipeline. Unknown keys
// are refused everywhere (no snapshot, business id, role or status can ride in).

const confidence = z.enum(LOGBOOK_CONFIDENCE);
const note = z.string().max(300).nullable().optional();

// What the vision model must return: amounts are numbers (or null), never text.
const extractedField = (kind) =>
  z.strictObject({
    value: kind === "amount" ? z.number().finite().nullable() : z.string().max(120).nullable(),
    confidence,
    note,
  });

// What an automation client may send: numeric text is accepted and parsed by
// the deterministic layer ("R 1 250,50"); unparseable text becomes null + low.
const importedField = (kind) =>
  z.strictObject({
    value: kind === "amount" ? z.union([z.number().finite(), z.string().max(40), z.null()]) : z.string().max(120).nullable(),
    confidence,
    note,
  });

const rowShape = (field) => Object.fromEntries(LOGBOOK_FIELDS.map(({ key, kind }) => [key, field(kind)]));

export const extractedRowSchema = z.strictObject(rowShape(extractedField));
export const extractionSchema = z.strictObject({
  rows: z.array(extractedRowSchema).max(80),
  pageNote: z.string().max(500).nullable().optional(),
});

export const importRowSchema = z.strictObject(rowShape(importedField));
export const importBodySchema = z.strictObject({
  rows: z.array(importRowSchema).min(1).max(200),
  reference: z.string().max(120).optional(),
});

const uuid = z.string().uuid();

// An admin edit carries plain values only; the server marks edited fields as
// confirmed by a person (confidence high, note kept as an audit of the edit).
export const editBodySchema = z.strictObject({
  rowId: uuid,
  values: z
    .partialRecord(z.enum(LOGBOOK_FIELDS.map((field) => field.key)), z.union([z.number().finite(), z.string().max(120), z.null()]))
    .refine((values) => Object.keys(values).length > 0, "Send at least one field to change."),
});
export const approveBodySchema = z.strictObject({ rowId: uuid, acknowledgeWarnings: z.boolean().optional() });
export const rejectBodySchema = z.strictObject({ rowId: uuid, reason: z.string().trim().min(3).max(300) });

export const uploadPageSchema = z.strictObject({
  filename: z.string().max(200).optional(),
  // The claimed type is informative only; the server decides from the bytes.
  mediaType: z.string().max(100).optional(),
  dataBase64: z.string().min(1),
});
export const extractBodySchema = z.strictObject({
  batchId: uuid.optional(),
  pages: z.array(uploadPageSchema).min(1).max(5),
});

export const keyBodySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name: z.string().trim().min(2).max(80) }),
  z.strictObject({ action: z.literal("revoke"), keyId: uuid }),
]);

export const describeZodError = (error) =>
  error.issues
    .slice(0, 8)
    .map((entry) => `${entry.path.join(".") || "(root)"}: ${entry.message}`)
    .join("; ");

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

// Deterministic row hash: same driver + vehicle + date + amounts = same hash,
// whatever the confidence, notes, spacing or capitalisation. The database holds
// one non-rejected row per (business, hash), and approved records take their ids
// from it, so the same row can never be imported or approved twice.
export const logbookRowHash = (fields) =>
  createHash("sha256").update(`taxiflow-logbook-row-v1:${stable(logbookRowIdentity(fields))}`).digest("hex");

// Canonical row for storage: normalized fields plus their hash.
export const canonicalLogbookRow = (rawFields) => {
  const fields = normalizeLogbookFields(rawFields);
  return { fields, rowHash: logbookRowHash(fields) };
};
