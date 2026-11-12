import {
  type AdapterContext,
  type Capability,
  type ConnectionResult,
  type GenerationRequest,
  type JobStatus,
  type ProviderAdapter,
  type SubmitResult,
  ProviderError,
  joinUrl,
  providerDetail,
  readProviderResponse,
} from "../types";

const CAPABILITIES: Capability[] = ["text_to_image", "image_edit"];

function aspectFor(request: GenerationRequest): string {
  if (request.aspect === "9:16") return "9:16";
  if (request.aspect === "1:1") return "1:1";
  return "16:9";
}

export const stabilityAdapter: ProviderAdapter = {
  code: "stability",
  defaultBaseUrl: "https://api.stability.ai",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (request.capability !== "text_to_image" && request.capability !== "image_edit") {
      throw new ProviderError(400, `Stability adapter does not submit ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
    }
    const form = new FormData();
    form.append("prompt", request.prompt);
    form.append("model", request.modelCode);
    form.append("aspect_ratio", aspectFor(request));
    form.append("output_format", "png");
    if (request.capability === "image_edit") {
      if (!request.source) throw new ProviderError(400, "Image editing needs a source image.", "", "SOURCE_REQUIRED");
      form.append("mode", "image-to-image");
      form.append("strength", "0.65");
      const bytes = await request.source.bytes();
      form.append("image", new Blob([new Uint8Array(bytes)], { type: request.source.contentType }), request.source.fileName);
    } else {
      form.append("mode", "text-to-image");
    }
    const doFetch = context.fetchImpl ?? fetch;
    const response = await doFetch(joinUrl(context.baseUrl, "/v2beta/stable-image/generate/sd3"), {
      method: "POST",
      headers: { authorization: `Bearer ${context.credentials.apiKey}`, accept: "image/*" },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const payload = await readProviderResponse(response);
      throw new ProviderError(
        response.status === 401 || response.status === 403 ? 502 : response.status,
        `Stability rejected the request (${response.status}).`,
        providerDetail(payload),
      );
    }
    const contentType = response.headers.get("content-type") || "image/png";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { image?: string };
      if (!payload?.image) throw new ProviderError(502, "Stability returned no image.", "", "PROVIDER_BAD_RESPONSE");
      return {
        externalId: `stability_${crypto.randomUUID()}`,
        status: "processing",
        immediateResult: { state: "succeeded", outputs: [{ base64: payload.image, contentType: "image/png", extension: "png" }] },
      };
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new ProviderError(502, "Stability returned an empty image.", "", "PROVIDER_BAD_RESPONSE");
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return {
      externalId: `stability_${crypto.randomUUID()}`,
      status: "processing",
      immediateResult: {
        state: "succeeded",
        outputs: [{ base64: btoa(binary), contentType, extension: contentType.includes("webp") ? "webp" : "png" }],
      },
    };
  },

  async getStatus(): Promise<JobStatus> {
    throw new ProviderError(501, "Stability image jobs complete synchronously.", "", "NOT_ASYNC");
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/user/account"), {
        headers: { authorization: `Bearer ${context.credentials.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { ok: true, detail: "Stability accepted the API key.", verified: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "Stability rejected the API key.", verified: true };
      }
      return { ok: false, detail: `Stability returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Stability could not be reached.", verified: false };
    }
  },
};
