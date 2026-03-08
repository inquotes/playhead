import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const raw = process.env.LASTFM_SESSION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("LASTFM_SESSION_ENCRYPTION_KEY is not configured.");
  }

  const trimmed = raw.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");

  if (key.length !== 32) {
    throw new Error("LASTFM_SESSION_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).");
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivHex, tagHex, dataHex] = payload.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted payload format.");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}
