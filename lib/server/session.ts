import { SESSION_COOKIE } from "./auth";
import { serialiseCookie } from "./http";

export function sessionCookieHeader(request: Request, token: string, expiresAt: number): string {
  const secure = new URL(request.url).protocol === "https:";
  const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  return serialiseCookie(SESSION_COOKIE, token, { maxAgeSeconds: maxAge, secure });
}

export function clearSessionCookieHeader(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  return serialiseCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure });
}

export function publicUser(user: {
  id: string;
  email: string;
  display_name: string;
  role: string;
  email_verified_at: number | null;
  created_at: number;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    emailVerified: Boolean(user.email_verified_at),
    createdAt: user.created_at,
  };
}
