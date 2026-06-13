import assert from "node:assert/strict";
import test from "node:test";
import { estimateTokens, type StoredMessage, selectContext } from "@/utils/memory.js";

test("estimateTokens is conservative for non-Latin text", () => {
  assert.ok(estimateTokens("halo dunia") >= 6);
  assert.ok(estimateTokens("こんにちは世界") > estimateTokens("hello"));
});

test("selectContext preserves recent messages and reports older messages", () => {
  const conversation: StoredMessage[] = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index} ${"content ".repeat(80)}`,
  }));
  const result = selectContext([{ role: "system", content: "system" }], conversation, "old summary", 600);
  assert.ok(result.oldMessages.length > 0);
  assert.equal(result.messages.at(-1)?.content, conversation.at(-1)?.content);
  assert.equal(result.stats.recentCount + result.stats.summarizedCount, conversation.length);
});
