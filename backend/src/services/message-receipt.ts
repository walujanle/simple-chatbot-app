import type { DatabaseExecutor } from "@/database/write.js";
import db, { nowIso } from "@/db.js";
import type { AIProvider, GenerationUsage, ReasoningEffort } from "@/providers/index.js";
import type { ContextStats } from "@/utils/memory.js";
import type { SearchResult } from "@/utils/search.js";

export type ReceiptSource = Pick<SearchResult, "title" | "url" | "snippet" | "retrievedAt">;

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
  usage: GenerationUsage;
  context: ContextStats;
}

interface MessageRow {
  id: number;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "completed" | "interrupted";
  error_code: string | null;
  created_at: string;
  provider: AIProvider | null;
  model: string | null;
  endpoint_host: string | null;
  latency_ms: number | null;
  web_search_used: number | null;
  search_query: string | null;
  sources_json: string | null;
  reasoning_enabled: number | null;
  reasoning_effort: ReasoningEffort | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  estimated_input_tokens: number | null;
  summarized_count: number | null;
  recent_count: number | null;
}

function parseSources(value: string | null): ReceiptSource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ReceiptSource[]) : [];
  } catch {
    return [];
  }
}

function toPublicMessage(row: MessageRow) {
  const receipt =
    row.provider && row.model
      ? {
          provider: row.provider,
          model: row.model,
          endpointHost: row.endpoint_host,
          latencyMs: row.latency_ms || 0,
          webSearchUsed: row.web_search_used === 1,
          searchQuery: row.search_query,
          sources: parseSources(row.sources_json),
          reasoningEnabled: row.reasoning_enabled === 1,
          reasoningEffort: row.reasoning_effort || "off",
          usage: {
            inputTokens: row.input_tokens ?? undefined,
            outputTokens: row.output_tokens ?? undefined,
            reasoningTokens: row.reasoning_tokens ?? undefined,
            totalTokens: row.total_tokens ?? undefined,
          },
          context: {
            estimatedInputTokens: row.estimated_input_tokens || 0,
            summarizedCount: row.summarized_count || 0,
            recentCount: row.recent_count || 0,
          },
        }
      : undefined;

  return {
    id: row.id,
    chat_id: row.chat_id,
    role: row.role,
    content: row.content,
    status: row.status,
    error_code: row.error_code,
    created_at: row.created_at,
    receipt,
  };
}

export async function listMessagesWithReceipts(chatId: string) {
  const recentMessages = db
    .selectFrom("messages")
    .select("id")
    .where("chat_id", "=", chatId)
    .orderBy("id", "desc")
    .limit(1000)
    .as("recent_messages");
  const rows = await db
    .selectFrom("messages as m")
    .innerJoin(recentMessages, "recent_messages.id", "m.id")
    .leftJoin("message_receipts as r", "r.message_id", "m.id")
    .select([
      "m.id",
      "m.chat_id",
      "m.role",
      "m.content",
      "m.status",
      "m.error_code",
      "m.created_at",
      "r.provider",
      "r.model",
      "r.endpoint_host",
      "r.latency_ms",
      "r.web_search_used",
      "r.search_query",
      "r.sources_json",
      "r.reasoning_enabled",
      "r.reasoning_effort",
      "r.input_tokens",
      "r.output_tokens",
      "r.reasoning_tokens",
      "r.total_tokens",
      "r.estimated_input_tokens",
      "r.summarized_count",
      "r.recent_count",
    ])
    .orderBy("m.id", "asc")
    .execute();
  return rows.map((row) => toPublicMessage(row as MessageRow));
}

export async function saveMessageReceipt(
  messageId: number,
  receipt: ResponseReceipt,
  executor: DatabaseExecutor = db,
): Promise<void> {
  await executor
    .insertInto("message_receipts")
    .values({
      message_id: messageId,
      provider: receipt.provider,
      model: receipt.model,
      endpoint_host: receipt.endpointHost,
      latency_ms: receipt.latencyMs,
      web_search_used: receipt.webSearchUsed ? 1 : 0,
      search_query: receipt.searchQuery,
      sources_json: JSON.stringify(receipt.sources),
      reasoning_enabled: receipt.reasoningEnabled ? 1 : 0,
      reasoning_effort: receipt.reasoningEffort,
      input_tokens: receipt.usage.inputTokens ?? null,
      output_tokens: receipt.usage.outputTokens ?? null,
      reasoning_tokens: receipt.usage.reasoningTokens ?? null,
      total_tokens: receipt.usage.totalTokens ?? null,
      estimated_input_tokens: receipt.context.estimatedInputTokens,
      summarized_count: receipt.context.summarizedCount,
      recent_count: receipt.context.recentCount,
      created_at: nowIso(),
    })
    .execute();
}

export interface MessageProviderInfo {
  provider: AIProvider;
  model: string;
}

export async function getReceiptsForMessages(messageIds: number[]): Promise<Map<number, MessageProviderInfo>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("message_receipts")
    .select(["message_id", "provider", "model"])
    .where("message_id", "in", messageIds)
    .execute();
  const map = new Map<number, MessageProviderInfo>();
  for (const row of rows) {
    map.set(row.message_id, { provider: row.provider, model: row.model });
  }
  return map;
}

export function getEndpointHost(baseUrl: string | null, provider: AIProvider): string {
  if (!baseUrl) {
    if (provider === "anthropic") return "api.anthropic.com";
    if (provider === "gemini") return "generativelanguage.googleapis.com";
    return "api.openai.com";
  }
  try {
    return new URL(baseUrl).host;
  } catch {
    return "custom endpoint";
  }
}
