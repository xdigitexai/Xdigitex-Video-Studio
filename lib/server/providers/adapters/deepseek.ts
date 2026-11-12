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

export const deepseekAdapter: ProviderAdapter = {
  code: "deepseek",
  defaultBaseUrl: "https://api.deepseek.com",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(): Promise<SubmitResult> {
    throw new ProviderError(400, "DeepSeek is available for prompt workflows only.", "", "CAPABILITY_UNSUPPORTED");
  },

  async getStatus(): Promise<JobStatus> {
    throw new ProviderError(501, "DeepSeek has no media jobs.", "", "NOT_ASYNC");
  },

  async enhancePrompt(context: AdapterContext, input: EnhancePromptInput): Promise<{ text: string }> {
    const payload = (await jsonRequest(context, joinUrl(context.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${context.credentials.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.modelCode,
        temperature: 0.7,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content:
              input.instructions ||
              "You write production-ready prompts for generative video and image models. Describe subject, setting, lighting, camera movement and mood. Return only the prompt, under 420 characters.",
          },
          { role: "user", content: input.prompt },
        ],
      }),
      timeoutMs: 60_000,
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError(502, "DeepSeek returned an empty prompt.", "", "PROVIDER_BAD_RESPONSE");
    return { text };
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/models"), {
        headers: { authorization: `Bearer ${context.credentials.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { ok: true, detail: "DeepSeek accepted the API key.", verified: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "DeepSeek rejected the API key.", verified: true };
      }
      return { ok: false, detail: `DeepSeek returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "DeepSeek could not be reached.", verified: false };
    }
  },
};
