import { AnthropicAdapter } from "@/providers/anthropic.js";
import { GeminiAdapter } from "@/providers/gemini.js";
import { OpenAICompatibleAdapter } from "@/providers/openai-compatible.js";
import type { ProviderAdapter, ProviderCredential } from "@/providers/types.js";

export type * from "@/providers/types.js";

export function createProviderAdapter(config: ProviderCredential): ProviderAdapter {
  if (config.provider === "anthropic") return new AnthropicAdapter(config);
  if (config.provider === "gemini") return new GeminiAdapter(config);
  return new OpenAICompatibleAdapter(config);
}
