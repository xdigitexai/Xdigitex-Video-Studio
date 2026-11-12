/**
 * Cryptographic primitives. Everything here runs on WebCrypto so the same code
 * executes in Cloudflare Workers and in Node (tests).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_PREFIX = "pbkdf2";

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [prefix, iterationText, saltText, hashText] = stored.split("$");
  if (prefix !== PBKDF2_PREFIX) return false;
  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromBase64(saltText) as BufferSource, iterations, hash: "SHA-256" },
      key,
      256,
    );
    return timingSafeEqual(new Uint8Array(bits), fromBase64(hashText));
  } catch {
    return false;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, payload: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
  const signature = await crypto.subtle.sign("HMAC", key, bytes as BufferSource);
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyHmacSha256(
  secret: string,
  payload: string | Uint8Array,
  signature: string,
): Promise<boolean> {
  if (!secret || !signature) return false;
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = await hmacSha256Hex(secret, payload);
  return timingSafeEqual(encoder.encode(provided.toLowerCase()), encoder.encode(expected));
}

async function aesKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  fingerprint: string;
}

export async function encryptSecret(plaintext: string, keyMaterial: string): Promise<EncryptedSecret> {
  if (!keyMaterial || keyMaterial.length < 16) {
    throw new Error("SECRETS_ENCRYPTION_KEY is missing or too short.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(keyMaterial);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    fingerprint: fingerprintSecret(plaintext),
  };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  keyMaterial: string,
): Promise<string> {
  const key = await aesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
    key,
    fromBase64(ciphertext) as BufferSource,
  );
  return decoder.decode(plaintext);
}

export function fingerprintSecret(secret: string): string {
  const cleaned = secret.trim();
  return cleaned.length <= 4 ? "••••" : cleaned.slice(-4);
}

export function maskSecret(last4: string): string {
  return `••••••••••••${last4 || "••••"}`;
}

/** Small helper for deterministic tests. */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}
