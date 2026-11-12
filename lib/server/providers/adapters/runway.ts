import {
  type AdapterContext,
  type Capability,
  type ConnectionResult,
  type GenerationRequest,
  type JobStatus,
  type ProviderAdapter,
  type ProviderOutput,
  type SourceMedia,
  type SubmitResult,
  ProviderError,
  joinUrl,
  jsonRequest,
} from "../types";

/**
 * Runway adapter — preserves the production request shapes used by the original
 * Studio (Gen-4.5 image_to_video, Aleph 2 video_to_video) and adds source upload
 * streaming for image/video conditioning.
 */
const RUNWAY_VERSION = "2024-11-06";
const CAPABILITIES: Capability[] = ["text_to_video", "image_to_video", "video_to_video"];

function authHeaders(context: AdapterContext): Record<string, string> {
  return {
    authorization: `Bearer ${context.credentials.apiKey}`,
    "X-Runway-Version": RUNWAY_VERSION,
  };
}

function ratioFor(aspect?: string): string {
  if (aspect === "9:16") return "720:1280";
  if (aspect === "1:1") return "960:960";
  return "1280:720";
}

async function uploadSource(context: AdapterContext, source: SourceMedia): Promise<string> {
  const payload = (await jsonRequest(context, joinUrl(context.baseUrl, "/v1/uploads"), {
    method: "POST",
    headers: { ...authHeaders(context), "content-type": "application/json" },
    body: JSON.stringify({ filename: source.fileName, type: "ephemeral" }),
    timeoutMs: 30_000,
  })) as { uploadUrl?: string; fields?: Record<string, string>; runwayUri?: string };
  if (!payload?.uploadUrl || !payload.runwayUri || !payload.fields) {
    throw new ProviderError(502, "Runway returned an incomplete upload request.", "", "PROVIDER_BAD_RESPONSE");
  }
  const boundary = `studio-${crypto.randomUUID()}`;
  const fieldPrefix = Object.entries(payload.fields)
    .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
    .join("");
  const safeName = source.fileName.replace(/[\r\n"\\]/g, "_");
  const filePrefix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${source.contentType}\r\n\r\n`;
  const encoder = new TextEncoder();
  const prefix = encoder.encode(fieldPrefix + filePrefix);
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const bodyStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(prefix);
      const reader = (await source.stream()).getReader();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          controller.enqueue(part.value);
        }
        controller.enqueue(suffix);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  const doFetch = context.fetchImpl ?? fetch;
  const response = await doFetch(payload.uploadUrl, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: bodyStream,
  });
  if (!response.ok) {
    throw new ProviderError(502, "Uploading the source to Runway failed.", `HTTP ${response.status}`, "PROVIDER_UPLOAD_FAILED");
  }
  return payload.runwayUri;
}

function outputFromUrl(url: string): ProviderOutput {
  const lower = url.toLowerCase();
  const isImage = /\.(png|jpe?g|webp)(\?|$)/.test(lower);
  return {
    url,
    contentType: isImage ? (lower.includes(".png") ? "image/png" : "image/jpeg") : "video/mp4",
    extension: isImage ? (lower.includes(".png") ? "png" : "jpg") : "mp4",
  };
}

export const runwayAdapter: ProviderAdapter = {
  code: "runway",
  defaultBaseUrl: "https://api.dev.runwayml.com",
  capabilities: CAPABILITIES,
  supportsCancel: false,

  async submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult> {
    if (!CAPABILITIES.includes(request.capability)) {
      throw new ProviderError(400, `Runway does not support ${request.capability}.`, "", "CAPABILITY_UNSUPPORTED");
    }
    if (request.capability === "video_to_video") {
      if (!request.source) throw new ProviderError(400, "Aleph 2 needs a source video.", "", "SOURCE_REQUIRED");
      const videoUri = await uploadSource(context, request.source);
      const task = (await jsonRequest(context, joinUrl(context.baseUrl, "/v1/video_to_video"), {
        method: "POST",
        headers: { ...authHeaders(context), "content-type": "application/json" },
        body: JSON.stringify({ model: request.modelCode, videoUri, promptText: request.prompt }),
        timeoutMs: 60_000,
      })) as { id?: string; status?: string };
      if (!task?.id) throw new ProviderError(502, "Runway returned no task ID.", "", "PROVIDER_BAD_RESPONSE");
      return { externalId: task.id, status: "queued", raw: task };
    }

    const body: Record<string, unknown> = {
      model: request.modelCode,
      promptText: request.prompt,
      ratio: ratioFor(request.aspect),
      duration: request.durationSeconds ?? 5,
    };
    if (request.source) {
      body.promptImage = await uploadSource(context, request.source);
    }
    const task = (await jsonRequest(context, joinUrl(context.baseUrl, "/v1/image_to_video"), {
      method: "POST",
      headers: { ...authHeaders(context), "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    })) as { id?: string; status?: string };
    if (!task?.id) throw new ProviderError(502, "Runway returned no task ID.", "", "PROVIDER_BAD_RESPONSE");
    return { externalId: task.id, status: "queued", raw: task };
  },

  async getStatus(context: AdapterContext, externalId: string): Promise<JobStatus> {
    const task = (await jsonRequest(
      context,
      joinUrl(context.baseUrl, `/v1/tasks/${encodeURIComponent(externalId)}`),
      { headers: authHeaders(context), timeoutMs: 30_000 },
    )) as {
      status?: string;
      output?: string[];
      failure?: string;
      progress?: number;
    };
    const status = (task.status || "").toUpperCase();
    const state =
      status === "SUCCEEDED"
        ? "succeeded"
        : status === "FAILED"
          ? "failed"
          : status === "CANCELLED" || status === "CANCELED"
            ? "canceled"
            : status === "RUNNING" || status === "THROTTLED"
              ? "processing"
              : "queued";
    return {
      state,
      progress: typeof task.progress === "number" ? Math.round(task.progress * 100) : undefined,
      outputs: (task.output ?? []).map(outputFromUrl),
      error: task.failure,
      providerRef: externalId,
      actualCostMicros: null,
      raw: task,
    };
  },

  async testConnection(context: AdapterContext): Promise<ConnectionResult> {
    const doFetch = context.fetchImpl ?? fetch;
    try {
      const response = await doFetch(joinUrl(context.baseUrl, "/v1/image_to_video"), {
        method: "POST",
        headers: { ...authHeaders(context), "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: "Runway rejected the API key.", verified: true };
      }
      if (response.status === 200 || response.status === 201) {
        return { ok: true, detail: "Runway accepted the credentials.", verified: true };
      }
      if (response.status === 400 || response.status === 422) {
        return { ok: true, detail: "Credentials accepted (validation response).", verified: true };
      }
      return { ok: false, detail: `Runway returned HTTP ${response.status}.`, verified: true };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "Runway could not be reached.",
        verified: false,
      };
    }
  },
};
