export const MS = 1;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function now(): number {
  return Date.now();
}

export function newId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function newReference(prefix = "XDG"): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function safeString(value: unknown, maxLength: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function formatUsd(micros: number): string {
  const dollars = micros / 1_000_000;
  return `$${dollars.toFixed(micros % 10_000 === 0 ? 2 : 4)}`;
}

export function formatCredits(credits: number): string {
  return new Intl.NumberFormat("en-US").format(credits);
}

export function monthEnd(startMs: number, months = 1): number {
  const date = new Date(startMs);
  const originalDay = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months);
  // Clamp overflowing days (Jan 31 + 1 month -> Feb 28/29).
  if (date.getUTCDate() < originalDay) date.setUTCDate(0);
  return date.getTime();
}
