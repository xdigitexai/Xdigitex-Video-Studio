import { dbFromRequestEnv, runtimeEnv, type RuntimeEnv } from "./runtime";
import type { Db } from "./db";
import { pageActor, pageAdmin } from "./context";
import { getWallet, type WalletSummary } from "./credits";
import { getEntitlements, type Entitlements } from "./plans";
import type { Actor } from "./auth-types";

export interface Frame {
  actor: Actor;
  db: Db;
  env: RuntimeEnv;
  wallet: WalletSummary;
  entitlements: Entitlements;
}

export async function loadFrame(returnTo: string): Promise<Frame> {
  const actor = await pageActor(returnTo);
  const db = dbFromRequestEnv();
  const env = runtimeEnv();
  const [wallet, entitlements] = await Promise.all([
    getWallet(db, actor.user.id),
    getEntitlements(db, actor.user.id),
  ]);
  return { actor, db, env, wallet, entitlements };
}

export async function loadAdminFrame(returnTo: string): Promise<Frame> {
  const actor = await pageAdmin(returnTo);
  const db = dbFromRequestEnv();
  const env = runtimeEnv();
  const [wallet, entitlements] = await Promise.all([
    getWallet(db, actor.user.id),
    getEntitlements(db, actor.user.id),
  ]);
  return { actor, db, env, wallet, entitlements };
}

export function shellUser(actor: Actor) {
  return {
    id: actor.user.id,
    displayName: actor.user.display_name,
    email: actor.user.email,
    role: actor.user.role,
  };
}
