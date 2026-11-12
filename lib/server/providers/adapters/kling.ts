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
  bytesToBase64,
  joinUrl,
  jsonRequest,
} from "../types";
import { toBase64Url } from "../../crypto";

const CAPABILITIES: Capability[] = ["text_to_video", "image_to_video"];

async function klingToken(context: AdapterContext): Promise<string> {
  if (!context.credentials.apiSecret) {
    throw new ProviderError(400, "Kling needs an access key and secret key.", "", "CREDENTIALS_INCOMPLETE");
  }
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const seconds = Math.floor(Date.now() / 1000);
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ iss: context.credentials.apiKey, exp: seconds + 1800, nbf: seconds - 5 }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(context.credentials.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

async function headers(context: AdapterContext): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await klingToken(context)}`, "content-type": "application/json" };
}

function outputsFromKling(payload: unknown): ProviderOutput[] {
  const record = payload as {
    data?: { task_result?: { videos?: Array<{ url?: string }> } };
  };
  return (record?.data?.task_result?.videos ?? [])
    .filter((video) => video?.url)
    .map((video) => ({ url: video.url!, contentType: "video/mp4", extension: "mp4" }));
}

export const klingAdapter: ProviderAdapter = {
  code: "kling",
  defaultBaseUrl: "https://api-singapore.klingai.com",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (!CAPABILITIES.includes(request.capability)) {
      throw new ProviderError(400, `Kling adapter does not submit ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
    }
    const body: Record<string, unknown> = {
      model_name: request.modelCode,
      prompt: request.prompt,
      duration: String(Math.min(10, Math.max(5, Math.round(request.durationSeconds ?? 5)))),
      mode: "pro",
      cfg_scale: 0.5,
    };
    let path = "/v1/videos/text2video";
    if (request.capability === "image_to_video") {
      if (!request.source) throw new ProviderError(400, "Kling image-to-video needs a source image.", "", "SOURCE_REQUIRED");
      if (!request.source.contentType.startsWith("image/")) {
        throw new ProviderError(400, "Kling image-to-video accepts an image source, not video.", "", "SOURCE_UNSUPPORTED");
      }
      path = "/v1/videos/image2video";
      body.image = bytesToBase64(await request.source.bytes());
    }
    const payload = (await jsonRequest(context, joinUrl(context.baseUrl, path), {
      method: "POST",
      headers: await headers(context),
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    })) as { code?: number; message?: string; data?: { task_id?: string } };
    if (payload?.code !== 0 || !payload?.data?.task_id) {
      throw new ProviderError(502, `Kling rejected the job: ${payload?.message ?? "unknown error"}`, "", "PROVIDER_REJECTED");
    }
    return { externalId: payload.data.task_id, status: "queued", raw: payload };
  },

  async getStatus(context: AdapterContext, externalId: string, request?: GenerationRequest): Promise<JobStatus> {
    const path = request?.capability === "image_to_video" ? "image2video" : "text2video";
    const payload = (await jsonRequest(
      context,
      joinUrl(context.baseUrl, `/v1/videos/${path}/${encodeURIComponent(externalId)}`),
      { headers: await headers(context), timeoutMs: 30_000 },
    )) as { code?: number; data?: { task_status?: string; task_status_msg?: string } };
    const status = (payload?.data?.task_status ?? "").toLowerCase();
    const state =
      status === "succeed"
        ? "succeeded"
        : status === "failed"
          ? "failed"
          : status === "processing"
            ? "processing"
            : "queued";
    return {
      state,
      outputs: state === "succeeded" ? outputsFromKling(payload) : undefined,
      error: payload?.data?.task_status_msg,
      actualCostMicros: null,
      providerRef: externalId,
      raw: payload,
    };
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/videos/text2video?pageNum=1&pageSize=1"), {
        headers: await headers(context),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { ok: true, detail: "Kling accepted the access key.", verified: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "Kling rejected the access key or token signature.", verified: true };
      }
      return { ok: false, detail: `Kling returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Kling could not be reached.", verified: false };
    }
  },
};
