import {
  type AdapterContext,
  type Capability,
  type ConnectionResult,
  type GenerationRequest,
  type JobStatus,
  type ProviderAdapter,
  type ProviderOutput,
  type SubmitResult,
  ProviderError,
  guessExtension,
  joinUrl,
  jsonRequest,
} from "../types";

const CAPABILITIES: Capability[] = ["text_to_image"];

function authHeaders(context: AdapterContext): Record<string, string> {
  return { authorization: `Bearer ${context.credentials.apiKey}`, "content-type": "application/json" };
}

function outputsFromReplicate(output: unknown): ProviderOutput[] {
  if (!output) return [];
  const items: unknown[] = Array.isArray(output) ? output : [output];
  const results: ProviderOutput[] = [];
  for (const item of items) {
    let url: string | undefined;
    let contentType = "image/png";
    if (typeof item === "string") url = item;
    else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (typeof record.url === "string") url = record.url;
      if (typeof record.content_type === "string") contentType = record.content_type;
    }
    if (url) results.push({ url, contentType, extension: guessExtension(contentType) });
  }
  return results;
}

export const replicateAdapter: ProviderAdapter = {
  code: "replicate",
  defaultBaseUrl: "https://api.replicate.com",
  capabilities: CAPABILITIES,
  supportsCancel: true,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (request.capability !== "text_to_image") {
      throw new ProviderError(400, `Replicate adapter does not submit ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
    }
    const payload = (await jsonRequest(
      context,
      joinUrl(context.baseUrl, `/v1/models/${request.modelCode}/predictions`),
      {
        method: "POST",
        headers: authHeaders(context),
        body: JSON.stringify({
          input: {
            prompt: request.prompt,
            aspect_ratio: request.aspect === "9:16" ? "9:16" : request.aspect === "1:1" ? "1:1" : "16:9",
            num_outputs: Math.min(4, Math.max(1, request.imageCount ?? 1)),
            output_format: "png",
          },
        }),
        timeoutMs: 60_000,
      },
    )) as { id?: string; status?: string; output?: unknown };
    if (!payload?.id) throw new ProviderError(502, "Replicate returned no prediction ID.", "", "PROVIDER_BAD_RESPONSE");
    if (payload.status === "succeeded" && payload.output) {
      return {
        externalId: payload.id,
        status: "processing",
        immediateResult: {
          state: "succeeded",
          outputs: outputsFromReplicate(payload.output),
          actualCostMicros: null,
          providerRef: payload.id,
        },
      };
    }
    return { externalId: payload.id, status: "queued", raw: payload };
  },

  async getStatus(context: AdapterContext, externalId: string): Promise<JobStatus> {
    const payload = (await jsonRequest(
      context,
      joinUrl(context.baseUrl, `/v1/predictions/${encodeURIComponent(externalId)}`),
      { headers: { authorization: `Bearer ${context.credentials.apiKey}` }, timeoutMs: 30_000 },
    )) as { status?: string; output?: unknown; error?: string };
    const status = payload.status ?? "starting";
    const state =
      status === "succeeded"
        ? "succeeded"
        : status === "failed"
          ? "failed"
          : status === "canceled"
            ? "canceled"
            : status === "processing"
              ? "processing"
              : "queued";
    return {
      state,
      outputs: state === "succeeded" ? outputsFromReplicate(payload.output) : undefined,
      error: payload.error,
      actualCostMicros: null,
      providerRef: externalId,
      raw: payload,
    };
  },

  async cancel(context: AdapterContext, externalId: string): Promise<void> {
    await jsonRequest(context, joinUrl(context.baseUrl, `/v1/predictions/${encodeURIComponent(externalId)}/cancel`), {
      method: "POST",
      headers: authHeaders(context),
      timeoutMs: 20_000,
    });
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/account"), {
        headers: { authorization: `Bearer ${context.credentials.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { ok: true, detail: "Replicate accepted the API token.", verified: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "Replicate rejected the API token.", verified: true };
      }
      return { ok: false, detail: `Replicate returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Replicate could not be reached.", verified: false };
    }
  },
};
