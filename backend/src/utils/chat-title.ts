import type { ProviderAdapter } from "@/providers/index.js";

const MAX_TITLE_LENGTH = 80;
const MAX_SOURCE_LENGTH = 2_000;

export function cleanGeneratedTitle(value: string): string {
  const normalized = value
    .replace(/^\s*#+\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^[\s>*`"']+|[\s>*`"']+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}

export async function generateChatTitle(
  adapter: ProviderAdapter,
  firstMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const source = firstMessage.slice(0, MAX_SOURCE_LENGTH);
  const result = await adapter.complete(
    [
      {
        role: "system",
        content:
          "Create a concise, specific chat title from the user's first message. Use the user's language. Return only the title without quotes, markdown, labels, or ending punctuation.",
      },
      { role: "user", content: source },
    ],
    signal,
    24,
  );
  return cleanGeneratedTitle(result);
}
