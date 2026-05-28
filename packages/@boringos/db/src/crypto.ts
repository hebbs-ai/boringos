import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

export function generateKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export function loadKey(): Buffer {
  const raw = process.env.BORINGOS_ENCRYPTION_KEY;
  if (!raw) throw new Error("BORINGOS_ENCRYPTION_KEY not set");
  const key = raw.match(/^[0-9a-f]{64}$/i)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`BORINGOS_ENCRYPTION_KEY must be ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
}

// Wire format: base64(iv[12 bytes] || tag[16 bytes] || ciphertext[N bytes])
export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptJson<T = unknown>(encoded: string, key: Buffer): T {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error(`Encrypted blob too short (${buf.length} bytes); expected at least ${IV_LEN + TAG_LEN + 1}`);
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
