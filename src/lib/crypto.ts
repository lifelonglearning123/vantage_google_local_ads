import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "@/lib/env";

/**
 * At-rest encryption for clients' GoHighLevel tokens. AES-256-GCM with a
 * random 12-byte IV per value; the auth tag guarantees integrity. Wire format
 * (base64 parts):
 *
 *   v1:<iv>:<auth tag>:<ciphertext>
 *
 * The key is ENCRYPTION_KEY: 32 bytes written as 64 hex characters. Changing
 * it makes every saved token unreadable, so every client would reconnect.
 */

const PREFIX = "v1";

function key(): Buffer {
  const hex = requireEnv("ENCRYPTION_KEY");
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Unrecognised encrypted value.");
  }
  const [, iv, tag, ct] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
