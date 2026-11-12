import {
  type AdapterContext,
  type Capability,
  type ConnectionResult,
  type EnhancePromptInput,
  type GenerationRequest,
  type JobStatus,
  type ProviderAdapter,
  type ProviderOutput,
  type SubmitResult,
  type TranscribeInput,
  type TranscriptResult,
  ProviderError,
  joinUrl,
  jsonRequest,
  providerDetail,
  readProviderResponse,
} from "../types";

const CAPABILITIES: Capability[] = ["text_to_image", "image_edit", "transcription", "prompt_enhance"];

function authHeaders(context: AdapterContext): Record<string, string> {
  return { authorization: `Bearer ${context.credentials.apiKey}` };
}

function sizeFor(request: GenerationRequest): string {
  const resolution = request.resolution || "";
  if (/^\d+x\d+$/.test(resolution)) return resolution;
  if (resolution === "1080p") return "1536x1024";
  if (request.aspect === "9:16") return "1024x1536";
  if (request.aspect === "16:9") return "1536x1024";
  return "1024x1024";
}

function outputsFromData(data: Array<{ b64_json?: string; url?: string }> | undefined): ProviderOutput[] {
  return (data ?? [])
    .map((item): ProviderOutput | null => {
      if (item.b64_json) return { base64: item.b64_json, contentType: "image/png", extension: "png" };
      if (item.url) return { url: item.url, contentType: "image/png", extension: "png" };
      return null;
    })
    .filter((value): value is ProviderOutput => value !== null);
}

export const openaiAdapter: ProviderAdapter = {
  code: "openai",
  defaultBaseUrl: "https://api.openai.com",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (request.capability === "text_to_image") {
      const payload = (await jsonRequest(context, joinUrl(context.baseUrl, "/v1/images/generations"), {
        method: "POST",
        headers: { ...authHeaders(context), "content-type": "application/json" },
        body: JSON.stringify({
          model: request.modelCode,
          prompt: request.prompt,
          size: sizeFor(request),
          n: Math.min(4, Math.max(1, request.imageCount ?? 1)),
        }),
        timeoutMs: 120_000,
      })) as { data?: Array<{ b64_json?: string; url?: string }> };
      const outputs = outputsFromData(payload?.data);
      if (!outputs.length) throw new ProviderError(502, "OpenAI returned no image.", "", "PROVIDER_BAD_RESPONSE");
      return {
        externalId: `openai_${crypto.randomUUID()}`,
        status: "processing",
        immediateResult: { state: "succeeded", outputs, actualCostMicros: null, providerRef: null },
      };
    }

    if (request.capability === "image_edit") {
      if (!request.source) throw new ProviderError(400, "Image editing needs a source image.", "", "SOURCE_REQUIRED");
      const form = new FormData();
      form.append("model", request.modelCode);
      form.append("prompt", request.prompt);
      form.append("size", sizeFor(request));
      form.append("n", String(Math.min(4, Math.max(1, request.imageCount ?? 1))));
      const bytes = await request.source.bytes();
      form.append("image", new Blob([new Uint8Array(bytes)], { type: request.source.contentType }), request.source.fileName);
      const doFetch = context.fetchImpl ?? fetch;
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/images/edits"), {
        method: "POST",
        headers: authHeaders(context),
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const payload = await readProviderResponse(response);
      if (!response.ok) {
        throw new ProviderError(
          response.status === 401 || response.status === 403 ? 502 : response.status,
          `OpenAI rejected the image edit (${response.status}).`,
          providerDetail(payload),
        );
      }
      const outputs = outputsFromData((payload as { data?: Array<{ b64_json?: string; url?: string }> })?.data);
      if (!outputs.length) throw new ProviderError(502, "OpenAI returned no image.", "", "PROVIDER_BAD_RESPONSE");
      return {
        externalId: `openai_${crypto.randomUUID()}`,
        status: "processing",
        immediateResult: { state: "succeeded", outputs, actualCostMicros: null, providerRef: null },
      };
    }

    throw new ProviderError(400, `OpenAI adapter does not submit ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
  },

  async getStatus(): Promise<JobStatus> {
    throw new ProviderError(501, "OpenAI image jobs complete synchronously.", "", "NOT_ASYNC");
  },

  async transcribe(context: AdapterContext, input: TranscribeInput): Promise<TranscriptResult> {
    const form = new FormData();
    const bytes = await input.source.bytes();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: input.source.contentType }), input.source.fileName);
    form.append("model", input.modelCode);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (input.language) form.append("language", input.language);
    const doFetch = context.fetchImpl ?? fetch;
    const response = await doFetch(joinUrl(context.baseUrl, "/v1/audio/transcriptions"), {
      method: "POST",
      headers: authHeaders(context),
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await readProviderResponse(response);
    if (!response.ok) {
      throw new ProviderError(
        response.status === 401 || response.status === 403 ? 502 : response.status,
        `Transcription failed (${response.status}).`,
        providerDetail(payload),
      );
    }
    const result = payload as {
      text?: string;
      language?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
    };
    const segments = (result.segments ?? [])
      .map((segment) => ({
        start: Math.max(0, Number(segment.start) || 0),
        end: Math.max(0, Number(segment.end) || 0),
        text: String(segment.text ?? "").trim(),
      }))
      .filter((segment) => segment.text);
    return {
      text: result.text ?? segments.map((segment) => segment.text).join(" "),
      segments: segments.length
        ? segments
        : [{ start: 0, end: Math.max(1, result.duration ?? 1), text: (result.text ?? "").trim() }].filter(
            (segment) => segment.text,
          ),
      language: result.language,
      durationSeconds: result.duration,
    };
  },

  async enhancePrompt(context: AdapterContext, input: EnhancePromptInput): Promise<{ text: string }> {
    const instructions =
      input.instructions ||
      "Rewrite the user's idea as one production-ready generative video/image prompt. Describe subject, setting, lighting, camera movement and mood. Return only the prompt, under 420 characters.";
    const payload = (await jsonRequest(context, joinUrl(context.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: { ...authHeaders(context), "content-type": "application/json" },
      body: JSON.stringify({
        model: input.modelCode,
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input.prompt },
        ],
      }),
      timeoutMs: 60_000,
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError(502, "The prompt writer returned an empty response.", "", "PROVIDER_BAD_RESPONSE");
    return { text };
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/models"), {
        headers: authHeaders(context),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { ok: true, detail: "OpenAI accepted the API key.", verified: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "OpenAI rejected the API key.", verified: true };
      }
      return { ok: false, detail: `OpenAI returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "OpenAI could not be reached.", verified: false };
    }
  },
};
