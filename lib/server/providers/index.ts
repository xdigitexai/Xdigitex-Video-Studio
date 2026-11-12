import type { ProviderAdapter } from "./types";
import { runwayAdapter } from "./adapters/runway";
import { openaiAdapter } from "./adapters/openai";
import { googleAdapter } from "./adapters/google";
import { anthropicAdapter } from "./adapters/anthropic";
import { deepseekAdapter } from "./adapters/deepseek";
import { klingAdapter } from "./adapters/kling";
import { replicateAdapter } from "./adapters/replicate";
import { falAdapter } from "./adapters/fal";
import { stabilityAdapter } from "./adapters/stability";

export const ADAPTERS: Record<string, ProviderAdapter> = {
  runway: runwayAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  anthropic: anthropicAdapter,
  deepseek: deepseekAdapter,
  kling: klingAdapter,
  replicate: replicateAdapter,
  fal: falAdapter,
  stability: stabilityAdapter,
};

export function adapterFor(code: string): ProviderAdapter | null {
  return ADAPTERS[code] ?? null;
}

export function providerCodes(): string[] {
  return Object.keys(ADAPTERS);
}

export function adapterCapabilities(code: string): readonly string[] {
  return ADAPTERS[code]?.capabilities ?? [];
}

export { ProviderError } from "./types";
export type {
  AdapterContext,
  Capability,
  ConnectionResult,
  GenerationRequest,
  JobStatus,
  ProviderAdapter,
  ProviderCredentials,
  ProviderOutput,
  SourceMedia,
  SubmitResult,
} from "./types";
