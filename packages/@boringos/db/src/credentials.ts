// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Credential helpers — AES-256-GCM wrap/unwrap for the `credentials`
// column on the `connector_accounts` table.
//
// Usage:
//   import { packCredentials, unpackCredentials } from "@boringos/db";
//
// Write path: pass through packCredentials before persisting.
// Read path:  pass through unpackCredentials after reading from DB.
//
// Backward compat: unpackCredentials accepts a plain object (legacy
// plaintext era). The migration script (Task 0.3) will re-encrypt all
// existing rows; until then both forms are silently accepted.

import { encryptJson, decryptJson, loadKey } from "./crypto.js";

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

// Test-only: reset the cached key so tests can exercise the "no env var" path.
export function _resetKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypt a credentials object to the wire format stored in the DB.
 * Call this at every write path before passing to Drizzle.
 */
export function packCredentials(value: Record<string, unknown>): string {
  return encryptJson(value, getKey());
}

/**
 * Decrypt a credentials value read from the DB.
 *
 * Accepts either:
 *  - A base64 ciphertext string (encrypted, post-Task-0.3)
 *  - A plain object (legacy plaintext, pre-migration) — returned as-is
 *  - null — returns null
 *
 * The plain-object branch is intentional. It keeps the system working
 * during the rolling deployment window before Task 0.3 re-encrypts
 * every existing row. DO NOT remove it until after 0.3 has run.
 */
export function unpackCredentials<T = Record<string, unknown>>(
  stored: string | Record<string, unknown> | null,
): T | null {
  if (stored === null) return null;
  // Backward compat: plain object from the pre-encryption era.
  if (typeof stored === "object") return stored as T;
  return decryptJson<T>(stored, getKey());
}

export { loadKey };
