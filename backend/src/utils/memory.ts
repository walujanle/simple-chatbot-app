import type { ModelMessage, ProviderAdapter } from "@/providers/index.js";

export interface StoredMessage extends ModelMessage {
  id: number;
}

export interface ContextStats {
  estimatedInputTokens: number;
  summarizedCount: number;
  recentCount: number;
}

export function estimateTokens(text: string): number {
  let latinChars = 0;
  let nonLatinChars = 0;
  for (const character of text) {
    if ((character.codePointAt(0) || 0) <= 0x7f) latinChars += 1;
    else nonLatinChars += 1;
  }
  return Math.ceil(latinChars / 3.6 + nonLatinChars / 1.8) + 4;
}

export function selectContext(
  systemMessages: ModelMessage[],
  conversation: StoredMessage[],
  summary: string | null,
  maxInputTokens: number,
): { messages: ModelMessage[]; oldMessages: StoredMessage[]; stats: ContextStats } {
  const fixed: ModelMessage[] = [...systemMessages];
  if (summary) {
    fixed.push({ role: "system", content: `Conversation summary from earlier turns:\n${summary}` });
  }
  const fixedTokens = fixed.reduce((total, message) => total + estimateTokens(message.content), 0);
  const recent: StoredMessage[] = [];
  let recentTokens = 0;
  const available = Math.max(512, maxInputTokens - fixedTokens);

  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message) continue;
    const tokens = estimateTokens(message.content);
    if (recent.length > 0 && recentTokens + tokens > available) break;
    recent.unshift(message);
    recentTokens += tokens;
  }

  const oldMessages = conversation.slice(0, conversation.length - recent.length);
  return {
    messages: [...fixed, ...recent.map(({ role, content }) => ({ role, content }))],
    oldMessages,
    stats: {
      estimatedInputTokens: fixedTokens + recentTokens,
      summarizedCount: oldMessages.length,
      recentCount: recent.length,
    },
  };
}

export async function summarizeConversation(
  adapter: ProviderAdapter,
  previousSummary: string | null,
  messages: StoredMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
  const summary = await adapter.complete(
    [
      {
        role: "system",
        content:
          "Create a compact factual conversation memory. Preserve user preferences, constraints, decisions, named entities, unresolved questions, and important technical details. Do not add facts. Return only the summary.",
      },
      {
        role: "user",
        content: `${previousSummary ? `Previous summary:\n${previousSummary}\n\n` : ""}New transcript:\n${transcript}`,
      },
    ],
    signal,
  );
  if (summary) return summary.slice(0, 12_000);
  return messages
    .map((message) => `${message.role}: ${message.content.slice(0, 300)}`)
    .join("\n")
    .slice(0, 12_000);
}
