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
  ProviderError,
  base64ToBytes,
  joinUrl,
  jsonRequest,
} from "../types";

const CAPABILITIES: Capability[] = ["text_to_image", "image_edit", "prompt_enhance"];

function modelUrl(context: AdapterContext, model: string, action: string): string {
  return joinUrl(
    context.baseUrl,
    `/v1beta/models/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(context.credentials.apiKey)}`,
  );
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

function extractParts(payload: unknown): GeminiPart[] {
  const record = payload as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  return record?.candidates?.[0]?.content?.parts ?? [];
}

function imageOutputs(parts: GeminiPart[]): ProviderOutput[] {
  return parts
    .filter((part) => part.inlineData?.data)
    .map((part) => ({
      base64: part.inlineData!.data!,
      contentType: part.inlineData!.mimeType || "image/png",
      extension: (part.inlineData!.mimeType || "image/png").includes("jpeg") ? "jpg" : "png",
    }));
}

export const googleAdapter: ProviderAdapter = {
  code: "google",
  defaultBaseUrl: "https://generativelanguage.googleapis.com",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (request.capability !== "text_to_image" && request.capability !== "image_edit") {
      throw new ProviderError(400, `Gemini adapter does not submit ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
    }
    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    if (request.source) {
      const bytes = await request.source.bytes();
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      parts.push({ inlineData: { mimeType: request.source.contentType, data: btoa(binary) } });
    }
    const payload = await jsonRequest(context, modelUrl(context, request.modelCode, "generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      timeoutMs: 120_000,
    });
    const outputs = imageOutputs(extractParts(payload));
    if (!outputs.length) {
      const text = extractParts(payload).map((part) => part.text).filter(Boolean).join(" ").slice(0, 300);
      throw new ProviderError(502, "Gemini returned no image.", text, "PROVIDER_BAD_RESPONSE");
    }
    return {
      externalId: `gemini_${crypto.randomUUID()}`,
      status: "processing",
      immediateResult: { state: "succeeded", outputs, actualCostMicros: null },
    };
  },

  async getStatus(): Promise<JobStatus> {
    throw new ProviderError(501, "Gemini image jobs complete synchronously.", "", "NOT_ASYNC");
  },

  async enhancePrompt(context: AdapterContext, input: EnhancePromptInput): Promise<{ text: string }> {
    const instructions =
      input.instructions ||
      "Rewrite the user's idea as one production-ready generative video/image prompt. Describe subject, setting, lighting, camera movement and mood. Return only the prompt, under 420 characters.";
    const payload = await jsonRequest(context, modelUrl(context, input.modelCode, "generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${instructions}\n\nIdea: ${input.prompt}` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
      }),
      timeoutMs: 60_000,
    });
    const text = extractParts(payload)
      .map((part) => part.text)
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!text) throw new ProviderError(502, "Gemini returned an empty prompt.", "", "PROVIDER_BAD_RESPONSE");
    return { text };
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(
        joinUrl(context.baseUrl, `/v1beta/models?key=${encodeURIComponent(context.credentials.apiKey)}`),
        { signal: AbortSignal.timeout(15_000) },
      );
      if (response.ok) return { ok: true, detail: "Gemini accepted the API key.", verified: true };
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { ok: false, detail: "Gemini rejected the API key.", verified: true };
      }
      return { ok: false, detail: `Gemini returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Gemini could not be reached.", verified: false };
    }
  },
};

// Keep base64ToBytes referenced for consumers that decode Gemini outputs.
void base64ToBytes;
