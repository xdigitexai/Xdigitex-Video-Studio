import { requireUser, guardMutation } from "@/lib/server/context";
import { quoteGeneration, type GenerationInput } from "@/lib/server/generation";
import { getWallet } from "@/lib/server/credits";
import { publicModel } from "@/lib/server/models";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    await guardMutation(request, db, "generation-estimate", 60, 60_000);
    const body = await readJson<Record<string, unknown>>(request);
    const input: GenerationInput = {
      projectId: safeString(body.projectId, 80),
      modelId: safeString(body.modelId, 80),
      capability: safeString(body.capability, 40),
      prompt: safeString(body.prompt, 2000) || "estimate",
      durationSeconds: clampInt(body.durationSeconds ?? body.duration, 1, 60, 5),
      aspect: safeString(body.aspect, 10) || "16:9",
      resolution: safeString(body.resolution, 30),
      imageCount: clampInt(body.imageCount, 1, 4, 1),
      sourceAssetId: body.sourceAssetId ? safeString(body.sourceAssetId, 80) : null,
    };
    const { model, quote } = await quoteGeneration(db, actor.user.id, input);
    const wallet = await getWallet(db, actor.user.id);
    return json({
      model: publicModel(model),
      estimate: {
        credits: quote.credits,
        priceUsd: quote.sellingPriceMicros / 1_000_000,
        priceLabel: `$${(quote.sellingPriceMicros / 1_000_000).toFixed(2)}`,
        units: quote.units,
        unitKind: quote.unitKind,
        estimated: quote.estimated,
        capability: input.capability,
      },
      balance: wallet.balance,
      available: wallet.available,
      canAfford: wallet.available >= quote.credits,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

