import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeProviderCostMicros,
  computeUnits,
  creditsForCharge,
  quoteCharge,
  selectOverride,
  sellingPriceFromCost,
  usdCentsToKesMinor,
  type ModelPricingConfig,
  type PricingOverrideConfig,
  type PricingSettingsConfig,
} from "../lib/server/pricing";

const settings: PricingSettingsConfig = {
  defaultMarginBps: 4000,
  minChargeMicros: 100_000,
  creditValueMicros: 10_000,
  version: 3,
};

const runway: ModelPricingConfig = {
  id: "mdl_runway_gen45",
  providerId: "prov_runway",
  pricingUnit: "per_second",
  unitCostMicros: 120_000, // $0.12 per second
  minChargeMicros: 0,
  pricingMeta: { resolutionMultipliers: { "720p": 1, "1080p": 1.5 } },
  isEstimated: true,
};

const context = {
  userId: "usr_a",
  planId: "plan_starter",
  providerId: "prov_runway",
  modelId: "mdl_runway_gen45",
  generationType: "text_to_video",
  durationSeconds: 5,
  resolution: "720p",
};

test("true gross margin, not markup: $0.80 at 40% sells at $1.34", () => {
  assert.equal(sellingPriceFromCost(800_000, 4000, 0), 1_340_000);
  // Markup would have produced $1.12 — the engine must not do that.
  assert.notEqual(sellingPriceFromCost(800_000, 4000, 0), 1_120_000);
});

test("individual customer margins change the selling price", () => {
  assert.equal(sellingPriceFromCost(800_000, 2000, 0), 1_000_000); // 20%
  assert.equal(sellingPriceFromCost(800_000, 5500, 0), 1_780_000); // 55%
});

test("selling price rounds up to the nearest cent and respects minimum charge", () => {
  assert.equal(sellingPriceFromCost(333_333, 4000, 0), 560_000);
  assert.equal(sellingPriceFromCost(1_000, 4000, 250_000), 250_000);
});

test("fixed selling price overrides margin and rounds up to cents", () => {
  assert.equal(sellingPriceFromCost(800_000, 4000, 0, 1_234_567), 1_240_000);
});

test("credits use the centrally configured credit value", () => {
  assert.equal(creditsForCharge(1_340_000, 10_000), 134);
  assert.equal(creditsForCharge(1, 10_000), 1);
});

test("provider cost supports per-second, per-minute, per-image and per-request units", () => {
  assert.deepEqual(computeUnits(runway, context), { units: 5, unitKind: "second" });
  assert.equal(computeProviderCostMicros(runway, context), 600_000);

  const minuteModel: ModelPricingConfig = { ...runway, pricingUnit: "per_minute", unitCostMicros: 6_000 };
  assert.deepEqual(computeUnits(minuteModel, { ...context, durationSeconds: 90 }), { units: 2, unitKind: "minute" });
  assert.equal(computeProviderCostMicros(minuteModel, { ...context, durationSeconds: 90 }), 12_000);

  const imageModel: ModelPricingConfig = { ...runway, pricingUnit: "per_image", unitCostMicros: 80_000 };
  assert.deepEqual(computeUnits(imageModel, { ...context, imageCount: 3 }), { units: 3, unitKind: "image" });
  assert.equal(computeProviderCostMicros(imageModel, { ...context, imageCount: 3 }), 240_000);

  const requestModel: ModelPricingConfig = { ...runway, pricingUnit: "per_request", unitCostMicros: 1_000 };
  assert.deepEqual(computeUnits(requestModel, context), { units: 1, unitKind: "request" });
});

test("resolution multipliers apply to provider cost", () => {
  assert.equal(computeProviderCostMicros(runway, { ...context, resolution: "1080p" }), 900_000);
});

test("provider minimum charge is a provider-cost floor", () => {
  const aleph: ModelPricingConfig = {
    ...runway,
    pricingUnit: "per_second",
    unitCostMicros: 280_000,
    minChargeMicros: 560_000,
  };
  assert.equal(computeProviderCostMicros(aleph, { ...context, durationSeconds: 1 }), 560_000);
});

test("quote for a 5 second Gen-4.5 clip is 100 credits", () => {
  const quote = quoteCharge(settings, [], runway, context);
  assert.equal(quote.providerCostMicros, 600_000);
  assert.equal(quote.sellingPriceMicros, 1_000_000);
  assert.equal(quote.credits, 100);
  assert.equal(quote.marginBps, 4000);
  assert.equal(quote.estimated, true);
});

test("a customer-specific 20% margin overrides the global 40%", () => {
  const overrides: PricingOverrideConfig[] = [
    { id: "rule_customer", userId: "usr_a", marginBps: 2000, updatedAt: 1 },
  ];
  const quote = quoteCharge(settings, overrides, runway, context);
  assert.equal(quote.marginBps, 2000);
  assert.equal(quote.sellingPriceMicros, 750_000);
  assert.equal(quote.credits, 75);
  assert.equal(quote.appliedRule.source, "override");
});

test("the most specific rule wins", () => {
  const overrides: PricingOverrideConfig[] = [
    { id: "global", marginBps: 3000, updatedAt: 1 },
    { id: "provider", providerId: "prov_runway", marginBps: 3500, updatedAt: 1 },
    { id: "model", modelId: "mdl_runway_gen45", marginBps: 3000, updatedAt: 1 },
    { id: "customer", userId: "usr_a", marginBps: 5000, updatedAt: 1 },
    { id: "customer_model", userId: "usr_a", modelId: "mdl_runway_gen45", marginBps: 5500, updatedAt: 1 },
  ];
  assert.equal(selectOverride(overrides, context)?.id, "customer_model");
  assert.equal(selectOverride(overrides, { ...context, userId: "usr_b" })?.id, "model");
  assert.equal(selectOverride(overrides, { ...context, userId: "usr_b", modelId: "other" })?.id, "provider");
});

test("a fixed price rule overrides margin calculation", () => {
  const overrides: PricingOverrideConfig[] = [
    { id: "fixed", userId: "usr_a", fixedPriceMicros: 2_000_000, updatedAt: 1 },
  ];
  const quote = quoteCharge(settings, overrides, runway, context);
  assert.equal(quote.sellingPriceMicros, 2_000_000);
  assert.equal(quote.credits, 200);
});

test("USD cents convert to the gateway's KES minor units", () => {
  assert.equal(usdCentsToKesMinor(1000, 130_000_000), 130_000); // $10 -> 1,300 KES
  assert.equal(usdCentsToKesMinor(2000, 130_500_000), 261_000); // $20 -> 2,610 KES
});
