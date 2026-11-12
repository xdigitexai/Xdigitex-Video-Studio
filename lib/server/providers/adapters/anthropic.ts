import {
  type AdapterContext,
  type Capability,
  type ConnectionResult,
  type EnhancePromptInput,
  type JobStatus,
  type ProviderAdapter,
  type SubmitResult,
  ProviderError,
  joinUrl,
  jsonRequest,
} from "../types";

const CAPABILITIES: Capability[] = ["prompt_enhance"];

function headers(context: AdapterContext): Record<string, string> {
  return {
    "x-api-key": context.credentials.apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

export const anthropicAdapter: ProviderAdapter = {
  code: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(): Promise<SubmitResult> {
    throw new ProviderError(400, "Anthropic is available for prompt workflows only.", "", "CAPABILITY_UNSUPPORTED");
  },

  async getStatus(): Promise<JobStatus> {
    throw new ProviderError(501, "Anthropic has no media jobs.", "", "NOT_ASYNC");
  },

  async enhancePrompt(context: AdapterContext, input: EnhancePromptInput): Promise<{ text: string }> {
    const payload = (await jsonRequest(context, joinUrl(context.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: headers(context),
      body: JSON.stringify({
        model: input.modelCode,
        max_tokens: 400,
        system:
          input.instructions ||
          "You write production-ready prompts for generative video and image models. Describe subject, setting, lighting, camera movement and mood. Return only the prompt, under 420 characters.",
        messages: [{ role: "user", content: input.prompt }],
      }),
      timeoutMs: 60_000,
    })) as { content?: Array<{ type?: string; text?: string }> };
    const text = (payload?.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ")
      .trim();
    if (!text) throw new ProviderError(502, "Claude returned an empty prompt.", "", "PROVIDER_BAD_RESPONSE");
    return { text };
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/models"), {
        headers: headers(context),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { ok: true, detail: "Anthropic accepted the API key.", verified: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "Anthropic rejected the API key.", verified: true };
      }
      return { ok: false, detail: `Anthropic returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Anthropic could not be reached.", verified: false };
    }
  },
};
