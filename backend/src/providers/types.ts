export type AIProvider = "openai-compatible" | "anthropic" | "gemini";
export type ReasoningEffort = "off" | "low" | "medium" | "high";

export interface ProviderCredential {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string | null;
  apiVersion: string | null;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  reasoningEffort: ReasoningEffort;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationRequest {
  messages: ModelMessage[];
  signal?: AbortSignal;
  reasoning: boolean;
}

export interface GenerationUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export type GenerationEvent =
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: GenerationUsage };

export interface ProviderAdapter {
  stream(request: GenerationRequest): AsyncGenerator<GenerationEvent>;
  complete(messages: ModelMessage[], signal?: AbortSignal, maxOutputTokens?: number): Promise<string>;
  validate(signal?: AbortSignal): Promise<void>;
}
