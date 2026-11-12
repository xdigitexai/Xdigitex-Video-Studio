/**
 * Dynamic cost + profit engine.
 *
 * Two financial values are always kept distinct:
 *   A. providerCostMicros — what the AI provider charges us.
 *   B. sellingPriceMicros — what the customer is charged.
 *
 * Selling price uses true gross margin, never markup:
 *   selling = providerCost / (1 - margin)
 *
 * All money values are integer USD micro-units (1e-6 USD).
 */

export type PricingUnit = "per_second" | "per_minute" | "per_image" | "per_request";

export const PRICING_UNITS: PricingUnit[] = ["per_second", "per_minute", "per_image", "per_request"];

export const GENERATION_TYPES = [
  "text_to_video",
  "image_to_video",
  "video_to_video",
  "text_to_image",
  "image_edit",
  "image_variations",
  "audio_generation",
  "transcription",
  "prompt_enhance",
] as const;

export type GenerationType = (typeof GENERATION_TYPES)[number];

export const CAPABILITY_LABELS: Record<string, string> = {
  text_to_video: "Text to video",
  image_to_video: "Image to video",
  video_to_video: "Video to video",
  text_to_image: "Text to image",
  image_edit: "Image editing",
  image_variations: "Image variations",
  audio_generation: "Audio generation",
  transcription: "Transcription",
  prompt_enhance: "Prompt enhancement",
};

export interface ModelPricingConfig {
  id: string;
  providerId: string;
  pricingUnit: PricingUnit;
  unitCostMicros: number;
  minChargeMicros: number;
  pricingMeta: {
    resolutionMultipliers?: Record<string, number>;
    sizeMultipliers?: Record<string, number>;
    outputMultiplier?: number;
  };
  isEstimated: boolean;
}

export interface PricingSettingsConfig {
  defaultMarginBps: number;
  minChargeMicros: number;
  creditValueMicros: number;
  version: number;
}

export interface PricingOverrideConfig {
  id: string;
  label?: string;
  userId?: string | null;
  planId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  generationType?: string | null;
  marginBps?: number | null;
  fixedPriceMicros?: number | null;
  minChargeMicros?: number | null;
  priority?: number;
  updatedAt?: number;
}

export interface PricingContext {
  userId: string;
  planId: string | null;
  providerId: string;
  modelId: string;
  generationType: string;
  durationSeconds?: number;
  imageCount?: number;
  resolution?: string;
  outputs?: number;
}

export interface ChargeQuote {
  providerCostMicros: number;
  sellingPriceMicros: number;
  marginBps: number;
  credits: number;
  creditValueMicros: number;
  units: number;
  unitKind: string;
  estimated: boolean;
  appliedRule: {
    source: "override" | "default";
    overrideId?: string;
    label?: string;
    specificity?: number;
    fixedPriceMicros?: number | null;
    minChargeMicros: number;
  };
}

const MAX_MARGIN_BPS = 9_900;

export function clampMargin(marginBps: number): number {
  if (!Number.isFinite(marginBps)) return 0;
  return Math.min(MAX_MARGIN_BPS, Math.max(0, Math.round(marginBps)));
}

export function computeUnits(model: ModelPricingConfig, context: PricingContext): { units: number; unitKind: string } {
  const outputs = Math.max(1, Math.floor(context.outputs ?? 1));
  switch (model.pricingUnit) {
    case "per_second":
      return { units: Math.max(1, Math.ceil(context.durationSeconds ?? 1)) * outputs, unitKind: "second" };
    case "per_minute":
      return { units: Math.max(1, Math.ceil((context.durationSeconds ?? 60) / 60)) * outputs, unitKind: "minute" };
    case "per_image":
      return { units: Math.max(1, Math.floor(context.imageCount ?? 1)) * outputs, unitKind: "image" };
    case "per_request":
    default:
      return { units: outputs, unitKind: "request" };
  }
}

function multiplierFor(model: ModelPricingConfig, context: PricingContext): number {
  const meta = model.pricingMeta ?? {};
  const resolution = context.resolution || "";
  const byResolution = meta.resolutionMultipliers?.[resolution];
  if (typeof byResolution === "number" && byResolution > 0) return byResolution;
  const bySize = meta.sizeMultipliers?.[resolution];
  if (typeof bySize === "number" && bySize > 0) return bySize;
  return 1;
}

export function computeProviderCostMicros(model: ModelPricingConfig, context: PricingContext): number {
  const { units } = computeUnits(model, context);
  const multiplier = multiplierFor(model, context);
  const raw = Math.ceil(model.unitCostMicros * units * multiplier);
  return Math.max(raw, Math.max(0, model.minChargeMicros));
}

/**
 * True gross-margin pricing. marginBps is expressed in basis points (4000 = 40%).
 * Result is rounded UP to the nearest cent so the platform never under-charges.
 */
export function sellingPriceFromCost(
  providerCostMicros: number,
  marginBps: number,
  minChargeMicros: number,
  fixedPriceMicros?: number | null,
): number {
  if (fixedPriceMicros && fixedPriceMicros > 0) {
    return Math.max(Math.ceil(fixedPriceMicros / 10_000) * 10_000, 0);
  }
  const margin = clampMargin(marginBps);
  const denominator = 10_000 - margin;
  if (denominator <= 0) throw new Error("Profit margin must be below 100%.");
  const raw = Math.ceil((providerCostMicros * 10_000) / denominator);
  const rounded = Math.ceil(raw / 10_000) * 10_000;
  const floor = Math.ceil(Math.max(0, minChargeMicros) / 10_000) * 10_000;
  return Math.max(rounded, floor, 0);
}

export function creditsForCharge(sellingPriceMicros: number, creditValueMicros: number): number {
  if (!Number.isFinite(creditValueMicros) || creditValueMicros <= 0) {
    throw new Error("Credit value must be a positive amount.");
  }
  return Math.max(1, Math.ceil(sellingPriceMicros / creditValueMicros));
}

export function overrideSpecificity(override: PricingOverrideConfig): number {
  let score = 0;
  if (override.userId) score += 16;
  if (override.modelId) score += 8;
  if (override.providerId) score += 4;
  if (override.planId) score += 2;
  if (override.generationType) score += 1;
  return score;
}

export function overrideMatches(override: PricingOverrideConfig, context: PricingContext): boolean {
  if (override.userId && override.userId !== context.userId) return false;
  if (override.planId && override.planId !== context.planId) return false;
  if (override.providerId && override.providerId !== context.providerId) return false;
  if (override.modelId && override.modelId !== context.modelId) return false;
  if (override.generationType && override.generationType !== context.generationType) return false;
  return true;
}

export function selectOverride(
  overrides: PricingOverrideConfig[],
  context: PricingContext,
): PricingOverrideConfig | null {
  const matches = overrides
    .filter((override) => overrideMatches(override, context))
    .sort((a, b) => {
      const specificity = overrideSpecificity(b) - overrideSpecificity(a);
      if (specificity !== 0) return specificity;
      const priority = (b.priority ?? 0) - (a.priority ?? 0);
      if (priority !== 0) return priority;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  return matches[0] ?? null;
}

export function quoteCharge(
  settings: PricingSettingsConfig,
  overrides: PricingOverrideConfig[],
  model: ModelPricingConfig,
  context: PricingContext,
): ChargeQuote {
  const providerCostMicros = computeProviderCostMicros(model, context);
  const override = selectOverride(overrides, context);
  const marginBps = clampMargin(override?.marginBps ?? settings.defaultMarginBps);
  const minChargeMicros = Math.max(settings.minChargeMicros, override?.minChargeMicros ?? 0, 0);
  const fixedPriceMicros = override?.fixedPriceMicros ?? null;
  const sellingPriceMicros = sellingPriceFromCost(
    providerCostMicros,
    marginBps,
    minChargeMicros,
    fixedPriceMicros,
  );
  const { units, unitKind } = computeUnits(model, context);
  return {
    providerCostMicros,
    sellingPriceMicros,
    marginBps,
    credits: creditsForCharge(sellingPriceMicros, settings.creditValueMicros),
    creditValueMicros: settings.creditValueMicros,
    units,
    unitKind,
    estimated: model.isEstimated,
    appliedRule: {
      source: override ? "override" : "default",
      overrideId: override?.id,
      label: override?.label,
      specificity: override ? overrideSpecificity(override) : 0,
      fixedPriceMicros,
      minChargeMicros,
    },
  };
}

/** Gross profit in micro-units; negative when a fixed price is set below cost. */
export function grossProfitMicros(quote: Pick<ChargeQuote, "sellingPriceMicros" | "providerCostMicros">): number {
  return quote.sellingPriceMicros - quote.providerCostMicros;
}

export function marginPercent(marginBps: number): string {
  return `${(marginBps / 100).toFixed(marginBps % 100 === 0 ? 0 : 1)}%`;
}

/** Converts a USD price to the gateway's KES minor units using a configured rate. */
export function usdCentsToKesMinor(usdCents: number, usdToKesRateMicros: number): number {
  const kes = (usdCents / 100) * (usdToKesRateMicros / 1_000_000);
  return Math.round(kes * 100);
}
