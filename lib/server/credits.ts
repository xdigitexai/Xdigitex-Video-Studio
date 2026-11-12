/**
 * Credit wallet and append-only ledger.
 *
 * Invariants:
 *  - `credit_wallets.balance` only changes through ledger-backed transactions.
 *  - `balance - reserved` is the spendable amount; it can never go negative.
 *  - Every balance mutation carries a unique ledger `reference`, which makes
 *    webhook retries, double settlement and double refunds idempotent.
 *  - Ledger rows are never updated or deleted.
 */

import type { Db } from "./db";
import { newId, now } from "./util";

export type LedgerKind = "grant" | "purchase" | "consume" | "refund" | "expire" | "adjust";

export interface WalletRow {
  user_id: string;
  balance: number;
  reserved: number;
  lifetime_purchased: number;
  lifetime_granted: number;
  lifetime_consumed: number;
  updated_at: number;
}

export interface GrantRow {
  id: string;
  user_id: string;
  source: string;
  source_id: string;
  credits: number;
  remaining: number;
  status: string;
  expires_at: number | null;
  created_at: number;
}

export interface WalletSummary {
  balance: number;
  reserved: number;
  available: number;
  lifetimePurchased: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
}

const LEDGER_COLUMNS =
  "(id, user_id, kind, amount, balance_after, reference, generation_id, payment_id, description, metadata, created_at)";

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint|UNIQUE constraint|constraint failed/i.test(message);
}

export async function ensureWallet(db: Db, userId: string, timestamp = now()): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO credit_wallets (user_id, balance, reserved, lifetime_purchased, lifetime_granted, lifetime_consumed, updated_at)
     VALUES (?, 0, 0, 0, 0, 0, ?)`,
    [userId, timestamp],
  );
}

export async function getWallet(db: Db, userId: string): Promise<WalletSummary> {
  await ensureWallet(db, userId);
  const row = await db.first<WalletRow>(
    `SELECT user_id, balance, reserved, lifetime_purchased, lifetime_granted, lifetime_consumed, updated_at
     FROM credit_wallets WHERE user_id = ?`,
    [userId],
  );
  const balance = row?.balance ?? 0;
  const reserved = row?.reserved ?? 0;
  return {
    balance,
    reserved,
    available: Math.max(0, balance - reserved),
    lifetimePurchased: row?.lifetime_purchased ?? 0,
    lifetimeGranted: row?.lifetime_granted ?? 0,
    lifetimeConsumed: row?.lifetime_consumed ?? 0,
  };
}

export interface GrantCreditsInput {
  userId: string;
  credits: number;
  source: "subscription" | "purchase" | "promo" | "refund" | "adjustment";
  sourceId?: string;
  reference: string;
  description?: string;
  expiresAt?: number | null;
  paymentId?: string | null;
  bumpLifetime?: "purchased" | "granted";
  kindForLedger?: LedgerKind;
}

/**
 * Adds credits and a matching grant lot. Returns false when the reference was
 * already processed (idempotent replay).
 */
export async function grantCredits(db: Db, input: GrantCreditsInput): Promise<boolean> {
  const credits = Math.floor(input.credits);
  if (!Number.isFinite(credits) || credits <= 0) throw new Error("Credit grant must be positive.");
  const timestamp = now();
  await ensureWallet(db, input.userId, timestamp);
  const ledgerId = newId("ledg");
  const grantId = newId("grt");
  const ledgerKind: LedgerKind =
    input.kindForLedger ??
    (input.source === "purchase"
      ? "purchase"
      : input.source === "refund"
        ? "refund"
        : input.source === "adjustment"
          ? "adjust"
          : "grant");
  const lifetimeColumn =
    input.bumpLifetime === "purchased"
      ? ", lifetime_purchased = lifetime_purchased + ?"
      : input.bumpLifetime === "granted"
        ? ", lifetime_granted = lifetime_granted + ?"
        : "";
  const lifetimeParams =
    input.bumpLifetime === "purchased" || input.bumpLifetime === "granted" ? [credits] : [];

  const results = await db.batch([
    {
      sql: `INSERT INTO credit_ledger ${LEDGER_COLUMNS}
            SELECT ?, ?, ?, ?, w.balance + ?, ?, NULL, ?, ?, '{}', ?
            FROM credit_wallets w
            WHERE w.user_id = ? AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE reference = ?)`,
      params: [
        ledgerId,
        input.userId,
        ledgerKind,
        credits,
        credits,
        input.reference,
        input.paymentId ?? null,
        input.description ?? "",
        timestamp,
        input.userId,
        input.reference,
      ],
    },
    {
      sql: `UPDATE credit_wallets SET balance = balance + ?, updated_at = ?${lifetimeColumn}
            WHERE user_id = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ? AND reference = ?)`,
      params: input.bumpLifetime
        ? [credits, timestamp, ...lifetimeParams, input.userId, ledgerId, input.reference]
        : [credits, timestamp, input.userId, ledgerId, input.reference],
    },
    {
      sql: `INSERT INTO credit_grants (id, user_id, source, source_id, credits, remaining, status, expires_at, created_at)
            SELECT ?, ?, ?, ?, ?, ?, 'active', ?, ?
            WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE id = ? AND reference = ?)`,
      params: [
        grantId,
        input.userId,
        input.source,
        input.sourceId ?? "",
        credits,
        credits,
        input.expiresAt ?? null,
        timestamp,
        ledgerId,
        input.reference,
      ],
    },
  ]);

  return (results[0]?.changes ?? 0) > 0;
}

export async function expireCredits(db: Db, userId: string, timestamp = now()): Promise<number> {
  const expired = await db.all<GrantRow>(
    `SELECT * FROM credit_grants
     WHERE user_id = ? AND status = 'active' AND remaining > 0 AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY expires_at ASC`,
    [userId, timestamp],
  );
  let expiredTotal = 0;
  for (const grant of expired) {
    const ledgerId = newId("ledg");
    try {
      const results = await db.batch([
        {
          sql: `INSERT INTO credit_ledger ${LEDGER_COLUMNS}
                SELECT ?, ?, 'expire', ?, w.balance - ?, ?, NULL, NULL, ?, '{"source":"expiry"}', ?
                FROM credit_wallets w
                WHERE w.user_id = ? AND w.balance >= ?
                  AND EXISTS (SELECT 1 FROM credit_grants WHERE id = ? AND status = 'active' AND remaining = ?)`,
          params: [
            ledgerId,
            userId,
            grant.remaining,
            grant.remaining,
            `grant-expire:${grant.id}`,
            `Expired ${grant.remaining} ${grant.source} credits`,
            timestamp,
            userId,
            grant.remaining,
            grant.id,
            grant.remaining,
          ],
        },
        {
          sql: `UPDATE credit_wallets SET balance = balance - ?, updated_at = ?
                WHERE user_id = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
          params: [grant.remaining, timestamp, userId, ledgerId],
        },
        {
          sql: `UPDATE credit_grants SET remaining = 0, status = 'expired'
                WHERE id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
          params: [grant.id, ledgerId],
        },
      ]);
      if ((results[0]?.changes ?? 0) > 0) expiredTotal += grant.remaining;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return expiredTotal;
}

export interface ReserveResult {
  ok: boolean;
  reservationId?: string;
  available: number;
}

export async function reserveCredits(
  db: Db,
  input: { userId: string; generationId: string; amount: number },
): Promise<ReserveResult> {
  const amount = Math.floor(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Reservation must be positive.");
  const timestamp = now();
  await ensureWallet(db, input.userId, timestamp);
  await expireCredits(db, input.userId, timestamp);

  const existing = await db.first<{ id: string; amount: number; status: string }>(
    `SELECT id, amount, status FROM credit_reservations WHERE generation_id = ?`,
    [input.generationId],
  );
  if (existing) {
    return { ok: existing.status === "held", reservationId: existing.id, available: (await getWallet(db, input.userId)).available };
  }

  const reservationId = newId("resv");
  try {
    await db.run(
      `INSERT INTO credit_reservations (id, user_id, generation_id, amount, settled_amount, status, created_at)
       VALUES (?, ?, ?, ?, 0, 'pending', ?)`,
      [reservationId, input.userId, input.generationId, amount, timestamp],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const wallet = await getWallet(db, input.userId);
      return { ok: false, available: wallet.available };
    }
    throw error;
  }

  const update = await db.run(
    `UPDATE credit_wallets SET reserved = reserved + ?, updated_at = ?
     WHERE user_id = ? AND balance - reserved >= ?`,
    [amount, timestamp, input.userId, amount],
  );
  if (update.changes !== 1) {
    await db.run(`DELETE FROM credit_reservations WHERE id = ?`, [reservationId]);
    const wallet = await getWallet(db, input.userId);
    return { ok: false, available: wallet.available };
  }
  await db.run(`UPDATE credit_reservations SET status = 'held' WHERE id = ?`, [reservationId]);
  return { ok: true, reservationId, available: (await getWallet(db, input.userId)).available };
}

export async function releaseReservation(
  db: Db,
  input: { generationId: string; userId: string },
): Promise<boolean> {
  const timestamp = now();
  const reservation = await db.first<{ id: string; amount: number; status: string }>(
    `SELECT id, amount, status FROM credit_reservations WHERE generation_id = ? AND user_id = ?`,
    [input.generationId, input.userId],
  );
  if (!reservation || reservation.status !== "held") return false;
  const results = await db.batch([
    {
      sql: `UPDATE credit_reservations SET status = 'released', released_at = ?
            WHERE id = ? AND status = 'held'`,
      params: [timestamp, reservation.id],
    },
    {
      sql: `UPDATE credit_wallets SET reserved = MAX(0, reserved - ?), updated_at = ?
            WHERE user_id = ? AND EXISTS (SELECT 1 FROM credit_reservations WHERE id = ? AND status = 'released')`,
      params: [reservation.amount, timestamp, input.userId, reservation.id],
    },
  ]);
  return (results[0]?.changes ?? 0) > 0;
}

export interface SettlementResult {
  applied: boolean;
  charged: number;
  released: number;
}

/**
 * Converts a hold into a final charge. The ledger insert is guarded by the
 * reservation state, so replaying settlement is a no-op.
 */
export async function settleCredits(
  db: Db,
  input: {
    userId: string;
    generationId: string;
    amount: number;
    reference: string;
    description?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<SettlementResult> {
  const amount = Math.max(0, Math.floor(input.amount));
  const timestamp = now();
  const reservation = await db.first<{ id: string; amount: number; status: string }>(
    `SELECT id, amount, status FROM credit_reservations WHERE generation_id = ? AND user_id = ?`,
    [input.generationId, input.userId],
  );
  if (!reservation) return { applied: false, charged: 0, released: 0 };
  if (reservation.status !== "held") {
    return {
      applied: false,
      charged: reservation.status === "settled" ? amount : 0,
      released: 0,
    };
  }
  const charge = Math.min(amount, reservation.amount);
  const release = Math.max(0, reservation.amount - charge);
  const ledgerId = newId("ledg");

  const grants = await db.all<GrantRow>(
    `SELECT * FROM credit_grants
     WHERE user_id = ? AND status = 'active' AND remaining > 0
     ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, created_at ASC`,
    [input.userId],
  );
  let remainingDraw = charge;
  const draws: Array<{ id: string; amount: number }> = [];
  for (const grant of grants) {
    if (remainingDraw <= 0) break;
    const draw = Math.min(grant.remaining, remainingDraw);
    if (draw > 0) {
      draws.push({ id: grant.id, amount: draw });
      remainingDraw -= draw;
    }
  }

  try {
    const statements = [
      {
        sql: `INSERT INTO credit_ledger ${LEDGER_COLUMNS}
              SELECT ?, ?, 'consume', ?, w.balance - ?, ?, ?, NULL, ?, ?, ?
              FROM credit_wallets w
              WHERE w.user_id = ? AND w.balance >= ? AND w.reserved >= ?
                AND EXISTS (SELECT 1 FROM credit_reservations WHERE id = ? AND status = 'held')`,
        params: [
          ledgerId,
          input.userId,
          charge,
          charge,
          input.reference,
          input.generationId,
          input.description ?? "Generation charge",
          JSON.stringify(input.metadata ?? {}),
          timestamp,
          input.userId,
          charge,
          reservation.amount,
          reservation.id,
        ],
      },
      {
        sql: `UPDATE credit_wallets
              SET balance = balance - ?, reserved = MAX(0, reserved - ?), lifetime_consumed = lifetime_consumed + ?, updated_at = ?
              WHERE user_id = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
        params: [charge, reservation.amount, charge, timestamp, input.userId, ledgerId],
      },
      ...draws.map((draw) => ({
        sql: `UPDATE credit_grants SET remaining = MAX(0, remaining - ?)
              WHERE id = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
        params: [draw.amount, draw.id, ledgerId],
      })),
      {
        sql: `UPDATE credit_grants SET status = 'exhausted'
              WHERE user_id = ? AND remaining <= 0 AND status = 'active'
                AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
        params: [input.userId, ledgerId],
      },
      {
        sql: `UPDATE credit_reservations
              SET status = 'settled', settled_amount = ?, settled_at = ?
              WHERE id = ? AND status = 'held' AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
        params: [charge, timestamp, reservation.id, ledgerId],
      },
    ];
    const results = await db.batch(statements);
    const applied = (results[0]?.changes ?? 0) > 0;
    return { applied, charged: applied ? charge : 0, released: applied ? release : 0 };
  } catch (error) {
    if (isUniqueViolation(error)) return { applied: false, charged: 0, released: 0 };
    throw error;
  }
}

/** Returns reserved credits to the wallet after a failed/cancelled generation. */
export async function refundReservation(
  db: Db,
  input: { userId: string; generationId: string; amount: number; reference: string; description?: string },
): Promise<boolean> {
  const reservation = await db.first<{ amount: number; status: string }>(
    `SELECT amount, status FROM credit_reservations WHERE generation_id = ? AND user_id = ?`,
    [input.generationId, input.userId],
  );
  if (!reservation) return false;
  if (reservation.status === "held") {
    return releaseReservation(db, { generationId: input.generationId, userId: input.userId });
  }
  if (reservation.status !== "settled") return false;
  const applied = await grantCredits(db, {
    userId: input.userId,
    credits: input.amount,
    source: "refund",
    sourceId: input.generationId,
    reference: input.reference,
    description: input.description ?? "Generation refund",
  });
  return applied;
}

export async function adjustCredits(
  db: Db,
  input: { userId: string; credits: number; reference: string; description: string; actorId?: string },
): Promise<boolean> {
  if (input.credits === 0) return false;
  if (input.credits > 0) {
    return grantCredits(db, {
      userId: input.userId,
      credits: input.credits,
      source: "adjustment",
      sourceId: input.actorId ?? "",
      reference: input.reference,
      description: input.description,
    });
  }
  const amount = Math.abs(input.credits);
  const timestamp = now();
  await ensureWallet(db, input.userId, timestamp);
  const ledgerId = newId("ledg");
  try {
    const results = await db.batch([
      {
        sql: `INSERT INTO credit_ledger ${LEDGER_COLUMNS}
              SELECT ?, ?, 'adjust', ?, w.balance - ?, ?, NULL, NULL, ?, '{}', ?
              FROM credit_wallets w
              WHERE w.user_id = ? AND w.balance - w.reserved >= ?
                AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE reference = ?)`,
        params: [
          ledgerId,
          input.userId,
          -amount,
          amount,
          input.reference,
          input.description,
          timestamp,
          input.userId,
          amount,
          input.reference,
        ],
      },
      {
        sql: `UPDATE credit_wallets SET balance = balance - ?, updated_at = ?
              WHERE user_id = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
        params: [amount, timestamp, input.userId, ledgerId],
      },
    ]);
    return (results[0]?.changes ?? 0) > 0;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function listLedger(
  db: Db,
  userId: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    kind: string;
    amount: number;
    balance_after: number;
    reference: string;
    description: string;
    generation_id: string | null;
    created_at: number;
  }>
> {
  return db.all(
    `SELECT id, kind, amount, balance_after, reference, description, generation_id, created_at
     FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, Math.min(200, Math.max(1, limit))],
  );
}
