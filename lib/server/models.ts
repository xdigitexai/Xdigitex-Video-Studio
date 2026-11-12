import type { Db } from "./db";
import { CAPABILITIES, type Capability } from "./providers/types";
import { parseJson } from "./util";

export interface ProviderRow {
  id: string;
  code: string;
  name: string;
  base_url: string | null;
  is_enabled: number;
  status: string;
  last_checked_at: number | null;
  last_error: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  code: string;
  display_name: string;
  description: string;
  capabilities: string;
  pricing_unit: string;
  unit_cost_micros: number;
  min_charge_micros: number;
  pricing_meta: string;
  max_duration_seconds: number;
  resolutions: string;
  is_active: number;
  is_default_video: number;
  is_default_image: number;
  is_estimated: number;
  sort_order: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface ModelView {
  id: string;
  providerId: string;
  providerCode: string;
  providerName: string;
  providerEnabled: boolean;
  code: string;
  displayName: string;
  description: string;
  capabilities: Capability[];
  pricingUnit: string;
  unitCostMicros: number;
  minChargeMicros: number;
  pricingMeta: Record<string, unknown>;
  maxDurationSeconds: number;
  resolutions: string[];
  isEstimated: boolean;
  isActive: boolean;
  isDefaultVideo: boolean;
  isDefaultImage: boolean;
  sortOrder: number;
}

type ModelWithProvider = ModelRow & {
  provider_code: string;
  provider_name: string;
  provider_enabled: number;
  provider_status: string;
  provider_base_url: string | null;
};

export function normaliseCapabilities(value: unknown): Capability[] {
  const list = Array.isArray(value) ? value : parseJson<string[]>(value, []);
  return list.filter((capability): capability is Capability =>
    (CAPABILITIES as readonly string[]).includes(capability),
  );
}

export function toModelView(row: ModelWithProvider): ModelView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerCode: row.provider_code,
    providerName: row.provider_name,
    providerEnabled: row.provider_enabled === 1,
    code: row.code,
    displayName: row.display_name,
    description: row.description,
    capabilities: normaliseCapabilities(row.capabilities),
    pricingUnit: row.pricing_unit,
    unitCostMicros: row.unit_cost_micros,
    minChargeMicros: row.min_charge_micros,
    pricingMeta: parseJson<Record<string, unknown>>(row.pricing_meta, {}),
    maxDurationSeconds: row.max_duration_seconds,
    resolutions: parseJson<string[]>(row.resolutions, []),
    isEstimated: row.is_estimated === 1,
    isActive: row.is_active === 1,
    isDefaultVideo: row.is_default_video === 1,
    isDefaultImage: row.is_default_image === 1,
    sortOrder: row.sort_order,
  };
}

export async function listProviders(db: Db): Promise<ProviderRow[]> {
  return db.all<ProviderRow>(`SELECT * FROM ai_providers ORDER BY sort_order ASC, name ASC`);
}

export async function getProvider(db: Db, idOrCode: string): Promise<ProviderRow | null> {
  return db.first<ProviderRow>(`SELECT * FROM ai_providers WHERE id = ? OR code = ? LIMIT 1`, [idOrCode, idOrCode]);
}

const MODEL_SELECT = `SELECT m.*, p.code AS provider_code, p.name AS provider_name,
  p.is_enabled AS provider_enabled, p.status AS provider_status, p.base_url AS provider_base_url
  FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id`;

export async function listModelRows(db: Db): Promise<ModelView[]> {
  const rows = await db.all<ModelWithProvider>(`${MODEL_SELECT} ORDER BY p.sort_order ASC, m.sort_order ASC`);
  return rows.map(toModelView);
}

export async function getModelView(db: Db, id: string): Promise<ModelView | null> {
  const row = await db.first<ModelWithProvider>(`${MODEL_SELECT} WHERE m.id = ? LIMIT 1`, [id]);
  return row ? toModelView(row) : null;
}

export async function getModelRow(db: Db, id: string): Promise<ModelRow | null> {
  return db.first<ModelRow>(`SELECT * FROM ai_models WHERE id = ?`, [id]);
}

export interface CustomerModel extends ModelView {
  planAllowed: boolean;
}

/**
 * Models a customer can select. Disabled providers/models are excluded, and
 * plan entitlement is resolved server-side from `plan_models`.
 */
export async function listCustomerModels(
  db: Db,
  options: { capability?: Capability; planModelIds: string[] | null },
): Promise<CustomerModel[]> {
  const rows = await db.all<ModelWithProvider>(
    `${MODEL_SELECT} WHERE m.is_active = 1 AND p.is_enabled = 1 ORDER BY p.sort_order ASC, m.sort_order ASC`,
  );
  const allowed = options.planModelIds ? new Set(options.planModelIds) : null;
  return rows
    .map(toModelView)
    .filter((model) => (options.capability ? model.capabilities.includes(options.capability) : true))
    .map((model) => ({ ...model, planAllowed: allowed ? allowed.has(model.id) : false }));
}

export async function selectDefaultModel(
  db: Db,
  kind: "video" | "image",
  allowedIds: string[] | null,
): Promise<ModelView | null> {
  const rows = await db.all<ModelWithProvider>(
    `${MODEL_SELECT} WHERE m.is_active = 1 AND p.is_enabled = 1 ORDER BY m.sort_order ASC`,
  );
  const models = rows.map(toModelView);
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const candidate = models.find((model) =>
    kind === "video" ? model.isDefaultVideo : model.isDefaultImage,
  );
  if (candidate && (!allowed || allowed.has(candidate.id))) return candidate;
  const fallback = models.find((model) =>
    allowed
      ? allowed.has(model.id)
      : kind === "video"
        ? model.capabilities.some((capability) => capability.endsWith("_video"))
        : model.capabilities.some((capability) => capability.startsWith("text_to_image")),
  );
  return fallback ?? null;
}

export async function setDefaultModel(db: Db, modelId: string, kind: "video" | "image"): Promise<void> {
  const column = kind === "video" ? "is_default_video" : "is_default_image";
  await db.batch([
    { sql: `UPDATE ai_models SET ${column} = 0, updated_at = ?`, params: [Date.now()] },
    { sql: `UPDATE ai_models SET ${column} = 1, updated_at = ? WHERE id = ?`, params: [Date.now(), modelId] },
  ]);
}

export function modelDisplayPriceLabel(model: ModelView): string {
  switch (model.pricingUnit) {
    case "per_second":
      return `$${(model.unitCostMicros / 1_000_000).toFixed(3)}/s provider cost`;
    case "per_minute":
      return `$${(model.unitCostMicros / 1_000_000).toFixed(3)}/min provider cost`;
    case "per_image":
      return `$${(model.unitCostMicros / 1_000_000).toFixed(3)}/image provider cost`;
    default:
      return `$${(model.unitCostMicros / 1_000_000).toFixed(3)}/request provider cost`;
  }
}

/** Customer-safe model shape. Never includes provider cost or margin. */
export function publicModel(model: ModelView, options: { planAllowed?: boolean } = {}) {
  return {
    id: model.id,
    name: model.displayName,
    description: model.description,
    provider: model.providerName,
    providerCode: model.providerCode,
    code: model.code,
    capabilities: model.capabilities,
    maxDurationSeconds: model.maxDurationSeconds,
    resolutions: model.resolutions,
    pricingUnit: model.pricingUnit,
    isDefaultVideo: model.isDefaultVideo,
    isDefaultImage: model.isDefaultImage,
    planAllowed: options.planAllowed ?? true,
  };
}
