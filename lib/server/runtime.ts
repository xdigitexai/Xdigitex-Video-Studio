import { env } from "cloudflare:workers";
import { d1Db, type Db } from "./db";

export interface RuntimeEnv {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  RUNWAY_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  REPLICATE_API_TOKEN?: string;
  FAL_KEY?: string;
  STABILITY_API_KEY?: string;
  KLING_ACCESS_KEY?: string;
  KLING_SECRET_KEY?: string;
  SECRETS_ENCRYPTION_KEY?: string;
  XDIGITEX_PAY_API_KEY?: string;
  XDIGITEX_PAY_BASE_URL?: string;
  XDIGITEX_WEBHOOK_SECRET?: string;
  XDIGITEX_PAY_SANDBOX?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_RELAY_URL?: string;
  EMAIL_RELAY_SECRET?: string;
  MAIL_API_URL?: string;
  MAIL_API_KEY?: string;
  ADMIN_EMAILS?: string;
  PLATFORM_AUTH_HEADERS?: string;
  APP_URL?: string;
  CRON_SECRET?: string;
  EMAIL_DEV_MODE?: string;
}

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function databaseFromEnv(source: RuntimeEnv): Db {
  if (!source.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the d1 binding in .openai/hosting.json.",
    );
  }
  return d1Db(source.DB as unknown as Parameters<typeof d1Db>[0]);
}

export function dbFromRequestEnv(): Db {
  return databaseFromEnv(runtimeEnv());
}

export function adminEmails(source: RuntimeEnv): string[] {
  return (source.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function platformAuthEnabled(source: RuntimeEnv): boolean {
  return (source.PLATFORM_AUTH_HEADERS || "enabled").toLowerCase() !== "disabled";
}

export function appBaseUrl(source: RuntimeEnv, request?: Request): string {
  if (source.APP_URL) return source.APP_URL.replace(/\/+$/, "");
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return "http://localhost:5173";
}
