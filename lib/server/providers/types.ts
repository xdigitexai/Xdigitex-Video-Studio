/**
 * Provider-independent AI contract.
 *
 * An adapter may only declare a capability that it actually implements. The
 * admin model catalogue is validated against these declarations, so the product
 * never sells a capability a provider cannot perform.
 */

export const CAPABILITIES = [
  "text_to_video",
  "image_to_video",
  "video_to_video",
  "text_to_image",
  "image_edit",
  "image_variations",
  "audio_generation",
  "transcription",
  "prompt_enhance",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface ProviderCredentials {
  apiKey: string;
  apiSecret?: string;
}

export interface AdapterContext {
  /** Admin-configured endpoint; adapters fall back to their documented default. */
  baseUrl: string;
  credentials: ProviderCredentials;
  fetchImpl?: typeof fetch;
}

export interface SourceMedia {
  fileName: string;
  contentType: string;
  byteSize: number;
  bytes(): Promise<Uint8Array>;
  stream(): Promise<ReadableStream<Uint8Array>>;
}

export interface GenerationRequest {
  modelCode: string;
  capability: Capability;
  prompt: string;
  durationSeconds?: number;
  aspect?: string;
  resolution?: string;
  imageCount?: number;
  quality?: string;
  source?: SourceMedia;
  extra?: Record<string, unknown>;
}

export interface ProviderOutput {
  url?: string;
  base64?: string;
  contentType: string;
  extension: string;
}

export type ProviderJobState = "queued" | "processing" | "succeeded" | "failed" | "canceled";

export interface SubmitResult {
  externalId: string;
  status: "queued" | "processing";
  raw?: unknown;
  /** For providers that return the finished asset synchronously. */
  immediateResult?: JobStatus;
}

export interface JobStatus {
  state: ProviderJobState;
  progress?: number;
  outputs?: ProviderOutput[];
  error?: string;
  /** Provider-reported exact cost when the provider exposes it. */
  actualCostMicros?: number | null;
  providerRef?: string | null;
  raw?: unknown;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  durationSeconds?: number;
}

export interface EnhancePromptInput {
  modelCode: string;
  prompt: string;
  instructions?: string;
}

export interface TranscribeInput {
  modelCode: string;
  source: SourceMedia;
  language?: string;
}

export interface ConnectionResult {
  ok: boolean;
  detail: string;
  verified: boolean;
}

export interface ProviderAdapter {
  code: string;
  defaultBaseUrl: string;
  capabilities: readonly Capability[];
  supportsCancel: boolean;
  submit(context: AdapterContext, request: GenerationRequest): Promise<SubmitResult>;
  getStatus(context: AdapterContext, externalId: string, request?: GenerationRequest): Promise<JobStatus>;
  cancel?(context: AdapterContext, externalId: string, request?: GenerationRequest): Promise<void>;
  testConnection(context: AdapterContext): Promise<ConnectionResult>;
  /** Synchronous transcription, billed as direct usage. */
  transcribe?(context: AdapterContext, input: TranscribeInput): Promise<TranscriptResult>;
  /** Synchronous prompt enhancement, billed as direct usage. */
  enhancePrompt?(context: AdapterContext, input: EnhancePromptInput): Promise<{ text: string }>;
}

export class ProviderError extends Error {
  status: number;
  code: string;
  detail: string;

  constructor(status: number, message: string, detail = "", code = "PROVIDER_ERROR") {
    super(message);
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

export function adapterFetch(context: AdapterContext): typeof fetch {
  return context.fetchImpl ?? fetch;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${trimBase(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function readProviderResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function providerDetail(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 400);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate =
      record.error ||
      record.message ||
      record.detail ||
      (record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>).message
        : undefined);
    if (typeof candidate === "string") return candidate.slice(0, 400);
  }
  try {
    return JSON.stringify(payload).slice(0, 400);
  } catch {
    return "Provider request failed.";
  }
}

export async function jsonRequest(
  context: AdapterContext,
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  const doFetch = adapterFetch(context);
  const { timeoutMs = 45_000, ...rest } = init;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(
      504,
      "The AI provider could not be reached.",
      error instanceof Error ? error.message : "Network error",
      "PROVIDER_UNREACHABLE",
    );
  }
  const payload = await readProviderResponse(response);
  if (!response.ok) {
    throw new ProviderError(
      response.status === 401 || response.status === 403 ? 502 : response.status,
      `The AI provider rejected the request (${response.status}).`,
      providerDetail(payload),
      response.status === 401 || response.status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REJECTED",
    );
  }
  return payload;
}

export async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function guessExtension(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("mp3")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  return "mp4";
}
