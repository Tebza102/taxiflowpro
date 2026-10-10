// Backup file encryption: AES-256-GCM with an scrypt-derived key (Node built-in
// crypto; no extra package, no plaintext and no passphrase written to disk).
// GCM authenticates the whole file, so a truncated, corrupted or tampered file
// and a wrong passphrase all fail to decrypt.
//
// File layout: "TFBK1\n" + JSON header line + "\n" + ciphertext + 16-byte tag.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = Buffer.from("TFBK1\n");
const KDF = { name: "scrypt", N: 2 ** 17, r: 8, p: 1, keyLength: 32 };
export const MIN_PASSPHRASE_LENGTH = 16;

const deriveKey = (passphrase, salt, kdf) =>
  scryptSync(String(passphrase).normalize("NFC"), salt, kdf.keyLength, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512 * 1024 * 1024 });

export const assertPassphrase = (passphrase) => {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`The backup passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
};

export const encryptBackup = (plaintext, passphrase) => {
  assertPassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = { ...KDF, salt: salt.toString("base64"), iv: iv.toString("base64"), cipher: "aes-256-gcm" };
  const headerLine = Buffer.from(`${JSON.stringify(header)}\n`);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt, KDF), iv);
  // The header is authenticated too, so it cannot be swapped.
  cipher.setAAD(Buffer.concat([MAGIC, headerLine]));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, headerLine, body, cipher.getAuthTag()]);
};

export const decryptBackup = (file, passphrase) => {
  if (!Buffer.isBuffer(file) || file.length < MAGIC.length + 20 || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a TaxiFlow backup file (or it is truncated).");
  }
  const headerEnd = file.indexOf(0x0a, MAGIC.length);
  if (headerEnd < 0) throw new Error("The backup header is damaged.");
  let header;
  try {
    header = JSON.parse(file.subarray(MAGIC.length, headerEnd).toString("utf8"));
  } catch {
    throw new Error("The backup header is damaged.");
  }
  if (header.name !== "scrypt" || header.cipher !== "aes-256-gcm") throw new Error("Unsupported backup encryption.");
  const body = file.subarray(headerEnd + 1, file.length - 16);
  const tag = file.subarray(file.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, Buffer.from(header.salt, "base64"), header), Buffer.from(header.iv, "base64"));
    decipher.setAAD(file.subarray(0, headerEnd + 1));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Decryption failed: wrong passphrase, or the file is corrupted or incomplete.");
  }
};
