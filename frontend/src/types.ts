export interface User {
  id: number;
  username: string;
  credentialResetRequired: boolean;
}

export interface Chat {
  id: string;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export type MessageStatus =
  | "preparing"
  | "searching"
  | "search_complete"
  | "search_unavailable"
  | "summarizing"
  | "thinking"
  | "generating"
  | "completed"
  | "interrupted";

export interface Message {
  id: number;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  status?: MessageStatus;
  error_code?: string | null;
  searchQuery?: string;
  searchSourceCount?: number;
  searchUnavailable?: boolean;
  reasoning?: string;
  receipt?: ResponseReceipt;
}

export interface ReceiptSource {
  title: string;
  url: string;
  snippet: string;
  retrievedAt: string;
}

export interface ResponseReceipt {
  provider: AIProvider;
  model: string;
  endpointHost: string | null;
  latencyMs: number;
  webSearchUsed: boolean;
  searchQuery: string | null;
  sources: ReceiptSource[];
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  context: {
    estimatedInputTokens: number;
    summarizedCount: number;
    recentCount: number;
  };
}

export type AIProvider = "openai-compatible" | "anthropic" | "gemini";
export type ReasoningEffort = "off" | "low" | "medium" | "high";

export interface ProviderConfig {
  id: string;
  name: string;
  provider: AIProvider;
  baseUrl: string | null;
  apiVersion: string | null;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  reasoningEffort: ReasoningEffort;
  isActive: boolean;
  hasApiKey: boolean;
  maskedApiKey: string;
  updatedAt: string;
}

export interface ProviderConfigInput {
  name: string;
  provider: AIProvider;
  apiKey?: string;
  reuseApiKeyFromConfigId?: string | null;
  baseUrl: string | null;
  apiVersion: string | null;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  reasoningEffort: ReasoningEffort;
  isActive: boolean;
}

export interface StreamChunk {
  content?: string;
  reasoning?: string;
  done?: boolean;
  error?: string;
  code?: string;
  status?: MessageStatus;
  query?: string;
  sourceCount?: number;
  userMessageId?: number;
  messageId?: number;
  chatTitle?: string;
  receipt?: ResponseReceipt;
  context?: {
    estimatedInputTokens: number;
    summarizedCount: number;
    recentCount: number;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
}
