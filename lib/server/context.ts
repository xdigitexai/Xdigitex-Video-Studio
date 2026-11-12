import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "./auth-types";
import { isAdminRole, isSuperAdminRole, resolveActor } from "./auth";
import { dbFromRequestEnv, adminEmails, platformAuthEnabled, runtimeEnv, type RuntimeEnv } from "./runtime";
import type { Db } from "./db";
import { ApiError, assertSameOrigin, clientIp, enforceRateLimit, userAgent } from "./http";
import { recordAudit } from "./audit";

export interface RequestContext {
  db: Db;
  env: RuntimeEnv;
  actor: Actor | null;
}

export function authConfig(env: RuntimeEnv = runtimeEnv()) {
  return {
    platformAuthEnabled: platformAuthEnabled(env),
    adminEmails: adminEmails(env),
    sessionDays: 30,
  };
}

export async function contextFromRequest(request: Request): Promise<RequestContext> {
  const env = runtimeEnv();
  const db = dbFromRequestEnv();
  const actor = await resolveActor(db, request.headers, authConfig(env));
  return { db, env, actor };
}

export async function requireUser(request: Request): Promise<RequestContext & { actor: Actor }> {
  const context = await contextFromRequest(request);
  if (!context.actor) {
    throw new ApiError(401, "Sign in to continue.", "UNAUTHENTICATED");
  }
  if (context.actor.user.status !== "active") {
    throw new ApiError(403, "This account is suspended.", "ACCOUNT_SUSPENDED");
  }
  return { ...context, actor: context.actor };
}

export async function requireAdmin(request: Request): Promise<RequestContext & { actor: Actor }> {
  const context = await requireUser(request);
  if (!isAdminRole(context.actor.user.role)) {
    throw new ApiError(403, "Administrator access is required.", "FORBIDDEN");
  }
  return context;
}

export async function requireSuperAdmin(request: Request): Promise<RequestContext & { actor: Actor }> {
  const context = await requireUser(request);
  if (!isSuperAdminRole(context.actor.user.role)) {
    throw new ApiError(403, "Super administrator access is required.", "FORBIDDEN");
  }
  return context;
}

export async function guardMutation(
  request: Request,
  db: Db,
  bucket: string,
  limit = 30,
  windowMs = 60_000,
): Promise<void> {
  assertSameOrigin(request);
  const actorKey = request.headers.get("oai-authenticated-user-id") || clientIp(request);
  await enforceRateLimit(db, `${bucket}:${actorKey}`, limit, windowMs);
}

export async function auditRequest(
  db: Db,
  request: Request,
  actor: Actor | null,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await recordAudit(db, {
    actorUserId: actor?.user.id ?? null,
    actorEmail: actor?.user.email ?? null,
    action,
    targetType,
    targetId,
    ip: clientIp(request),
    userAgent: userAgent(request),
    metadata,
  });
}

/** Server component helper: resolves the signed-in actor or redirects to login. */
export async function pageActor(returnTo: string): Promise<Actor> {
  const headerList = await headers();
  const db = dbFromRequestEnv();
  const actor = await resolveActor(db, new Headers(headerList), authConfig());
  if (!actor || actor.user.status !== "active") {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return actor;
}

export async function optionalPageActor(): Promise<Actor | null> {
  const headerList = await headers();
  const db = dbFromRequestEnv();
  return resolveActor(db, new Headers(headerList), authConfig());
}

export async function pageAdmin(returnTo: string): Promise<Actor> {
  const actor = await pageActor(returnTo);
  if (!isAdminRole(actor.user.role)) redirect("/dashboard?error=forbidden");
  return actor;
}
