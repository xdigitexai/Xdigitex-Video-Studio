import type { Db } from "./db";
import { now, parseJson } from "./util";
import type { PricingSettingsConfig, PricingOverrideConfig } from "./pricing";

export interface PricingSettingsRow {
  id: number;
  default_margin_bps: number;
  min_charge_micros: number;
  credit_value_micros: number;
  usd_to_kes_rate_micros: number;
  grace_period_days: number;
  currency: string;
  version: number;
  updated_at: number;
}

const DEFAULTS: PricingSettingsRow = {
  id: 1,
  default_margin_bps: 4000,
  min_charge_micros: 100000,
  credit_value_micros: 10000,
  usd_to_kes_rate_micros: 130_000_000,
  grace_period_days: 3,
  currency: "USD",
  version: 1,
  updated_at: 0,
};

export async function getPricingSettings(db: Db): Promise<PricingSettingsRow> {
  let row = await db.first<PricingSettingsRow>(`SELECT * FROM pricing_settings WHERE id = 1`);
  if (!row) {
    const timestamp = now();
    await db.run(
      `INSERT OR IGNORE INTO pricing_settings (id, default_margin_bps, min_charge_micros, credit_value_micros, usd_to_kes_rate_micros, grace_period_days, currency, version, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        DEFAULTS.default_margin_bps,
        DEFAULTS.min_charge_micros,
        DEFAULTS.credit_value_micros,
        DEFAULTS.usd_to_kes_rate_micros,
        DEFAULTS.grace_period_days,
        DEFAULTS.currency,
        timestamp,
      ],
    );
    row = await db.first<PricingSettingsRow>(`SELECT * FROM pricing_settings WHERE id = 1`);
  }
  return row ?? { ...DEFAULTS, updated_at: now() };
}

export function pricingConfig(row: PricingSettingsRow): PricingSettingsConfig {
  return {
    defaultMarginBps: row.default_margin_bps,
    minChargeMicros: row.min_charge_micros,
    creditValueMicros: row.credit_value_micros,
    version: row.version,
  };
}

export interface PricingOverrideRow {
  id: string;
  label: string;
  user_id: string | null;
  plan_id: string | null;
  provider_id: string | null;
  model_id: string | null;
  generation_type: string | null;
  margin_bps: number | null;
  fixed_price_micros: number | null;
  min_charge_micros: number | null;
  priority: number;
  is_active: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export async function listPricingOverrides(db: Db, activeOnly = true): Promise<PricingOverrideRow[]> {
  return db.all<PricingOverrideRow>(
    `SELECT * FROM pricing_overrides ${activeOnly ? "WHERE is_active = 1" : ""} ORDER BY updated_at DESC`,
  );
}

export function overrideConfig(row: PricingOverrideRow): PricingOverrideConfig {
  return {
    id: row.id,
    label: row.label,
    userId: row.user_id,
    planId: row.plan_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    generationType: row.generation_type,
    marginBps: row.margin_bps,
    fixedPriceMicros: row.fixed_price_micros,
    minChargeMicros: row.min_charge_micros,
    priority: row.priority,
    updatedAt: row.updated_at,
  };
}

export async function getAppSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.first<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export async function getAppSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.all<{ key: string; value: string }>(`SELECT key, value FROM app_settings`);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setAppSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now()],
  );
}

export async function isSignupEnabled(db: Db): Promise<boolean> {
  return (await getAppSetting(db, "signup_enabled")) !== "false";
}

export async function isMaintenanceMode(db: Db): Promise<boolean> {
  return (await getAppSetting(db, "maintenance_mode")) === "true";
}

export async function isEmailVerificationRequired(db: Db): Promise<boolean> {
  return (await getAppSetting(db, "email_verification_required")) !== "false";
}

export function parseStringArray(value: string | null): string[] {
  return parseJson<string[]>(value, []);
}
