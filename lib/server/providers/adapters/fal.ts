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

function headers(context: AdapterContext): Record<string, string> {
  return { authorization: `Key ${context.credentials.apiKey}`, "content-type": "application/json" };
}

function outputsFromFal(payload: unknown): ProviderOutput[] {
  const record = payload as { images?: Array<{ url?: string; content_type?: string }>; image?: { url?: string } };
  const items: Array<{ url?: string; content_type?: string }> =
    record?.images ?? (record?.image ? [record.image] : []);
  return items
    .filter((item) => item?.url)
    .map((item) => {
      const contentType = item.content_type || "image/png";
      return { url: item.url!, contentType, extension: guessExtension(contentType) };
    });
}

export const falAdapter: ProviderAdapter = {
  code: "fal",
  defaultBaseUrl: "https://queue.fal.run",
  capabilities: CAPABILITIES,
  supportsCancel: true,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (request.capability !== "text_to_image") {
      throw new ProviderError(400, `fal adapter does not submit ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
    }
    const payload = (await jsonRequest(context, joinUrl(context.baseUrl, `/${request.modelCode}`), {
      method: "POST",
      headers: headers(context),
      body: JSON.stringify({
        prompt: request.prompt,
        image_size: request.aspect === "9:16" ? "portrait_16_9" : request.aspect === "1:1" ? "square_hd" : "landscape_16_9",
        num_images: Math.min(4, Math.max(1, request.imageCount ?? 1)),
        enable_safety_checker: true,
      }),
      timeoutMs: 60_000,
    })) as { request_id?: string };
    if (!payload?.request_id) throw new ProviderError(502, "fal returned no request ID.", "", "PROVIDER_BAD_RESPONSE");
    return { externalId: payload.request_id, status: "queued", raw: payload };
  },

  async getStatus(context: AdapterContext, externalId: string, request?: GenerationRequest): Promise<JobStatus> {
    if (!request) throw new ProviderError(400, "fal status needs the model reference.", "", "MODEL_REQUIRED");
    const base = joinUrl(context.baseUrl, `/${request.modelCode}`);
    const status = (await jsonRequest(
      context,
      `${base}/requests/${encodeURIComponent(externalId)}/status`,
      { headers: headers(context), timeoutMs: 30_000 },
    )) as { status?: string };
    const state = status.status;
    if (state === "COMPLETED") {
      const result = await jsonRequest(context, `${base}/requests/${encodeURIComponent(externalId)}`, {
        headers: headers(context),
        timeoutMs: 30_000,
      });
      return {
        state: "succeeded",
        outputs: outputsFromFal(result),
        actualCostMicros: null,
        providerRef: externalId,
        raw: result,
      };
    }
    return {
      state: state === "IN_PROGRESS" ? "processing" : state === "FAILED" ? "failed" : "queued",
      error: state === "FAILED" ? "fal reported the request failed." : undefined,
      actualCostMicros: null,
      providerRef: externalId,
      raw: status,
    };
  },

  async cancel(context: AdapterContext, externalId: string, request?: GenerationRequest): Promise<void> {
    if (!request) throw new ProviderError(400, "fal cancel needs the model reference.", "", "MODEL_REQUIRED");
    await jsonRequest(context, joinUrl(context.baseUrl, `/${request.modelCode}/requests/${encodeURIComponent(externalId)}/cancel`), {
      method: "PUT",
      headers: headers(context),
      timeoutMs: 20_000,
    });
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/fal-ai/flux/schnell/requests/healthcheck/status"), {
        headers: { authorization: `Key ${context.credentials.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "fal rejected the API key.", verified: true };
      }
      return { ok: true, detail: "fal accepted the API key (auth probe).", verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "fal could not be reached.", verified: false };
    }
  },
};
