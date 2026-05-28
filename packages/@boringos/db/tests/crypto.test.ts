import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson, generateKey } from "../src/crypto.js";

describe("crypto", () => {
  it("round-trips JSON through encrypt/decrypt", () => {
    const key = generateKey();
    const original = { accessToken: "abc", refreshToken: "xyz", expiresAt: 123 };
    const encrypted = encryptJson(original, key);
    const decrypted = decryptJson(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it("produces different ciphertext for same input (random IV)", () => {
    const key = generateKey();
    const data = { token: "same" };
    const a = encryptJson(data, key);
    const b = encryptJson(data, key);
    expect(a).not.toEqual(b);
  });

  it("throws on tampered ciphertext", () => {
    const key = generateKey();
    const encrypted = encryptJson({ x: 1 }, key);
    const tampered = encrypted.slice(0, -2) + "XX";
    expect(() => decryptJson(tampered, key)).toThrow();
  });

  it("throws on wrong key", () => {
    const key1 = generateKey();
    const key2 = generateKey();
    const encrypted = encryptJson({ x: 1 }, key1);
    expect(() => decryptJson(encrypted, key2)).toThrow();
  });
});
