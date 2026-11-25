import { decryptSecret, encryptSecret, hmacSha256Hex } from "./crypto";

const encoder = new TextEncoder();
const PERIOD_SECONDS = 30;
const DIGITS = 6;

function base32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function generateMfaSecret(): string {
  return base32(crypto.getRandomValues(new Uint8Array(20)));
}

async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000), false);
  view.setUint32(4, counter >>> 0, false);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const value =
    (((signature[offset] & 0x7f) << 24) | (signature[offset + 1] << 16) | (signature[offset + 2] << 8) | signature[offset + 3]) >>> 0;
  return String(value % 10 ** DIGITS).padStart(DIGITS, "0");
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const cleaned = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const counter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  for (const step of [-1, 0, 1]) {
    const expected = await totpAt(secret, counter + step);
    if (expected === cleaned) return true;
  }
  return false;
}

export function mfaProvisioningUri(secret: string, email: string): string {
  const label = encodeURIComponent(`Malaba AI Studio:${email}`);
  const issuer = encodeURIComponent("Malaba AI Studio");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function encryptMfaSecret(secret: string, keyMaterial: string): Promise<string> {
  const encrypted = await encryptSecret(secret, keyMaterial);
  return `${encrypted.iv}:${encrypted.ciphertext}`;
}

export async function decryptMfaSecret(stored: string, keyMaterial: string): Promise<string | null> {
  if (!stored || !stored.includes(":")) return null;
  const [iv, ciphertext] = stored.split(":", 2);
  try {
    return await decryptSecret(ciphertext, iv, keyMaterial);
  } catch {
    return null;
  }
}

/** Recovery codes are stored as SHA-256 hashes, never in plain text. */
export async function hashRecoveryCode(code: string): Promise<string> {
  return hmacSha256Hex("mfa-recovery", code.trim().toLowerCase());
}
