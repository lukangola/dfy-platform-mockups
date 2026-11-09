/**
 * AES-256-GCM at-rest encryption for Performance data-source credentials
 * (Shopify admin token, Meta access token, Google Ads secrets).
 * Key: CONNECTIONS_KEY (32-byte hex) — the same key the AI-employees branch
 * uses for its connection store, so one secret serves both. PERFORMANCE_SECRETS_KEY
 * overrides it if a separate key is wanted.
 * Wire format: base64(iv[12] | tag[16] | ciphertext), prefixed "enc1:".
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const hex = (process.env.PERFORMANCE_SECRETS_KEY || process.env.CONNECTIONS_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "Credential encryption key missing: set CONNECTIONS_KEY (32-byte hex) in .env.local — " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

export function hasSecretsKey(): boolean {
  try { keyBytes(); return true; } catch { return false; }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith("enc1:")) throw new Error("Unknown secret format");
  const buf = Buffer.from(stored.slice(5), "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
