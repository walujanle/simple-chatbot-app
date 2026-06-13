import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderAdapter } from "@/providers/index.js";
import { cleanGeneratedTitle, generateChatTitle } from "@/utils/chat-title.js";

test("cleanGeneratedTitle removes model formatting", () => {
  assert.equal(cleanGeneratedTitle('## Title: "Perbaikan Web Search Chatbot."'), "Perbaikan Web Search Chatbot");
});

test("cleanGeneratedTitle limits titles to 80 characters", () => {
  const title = cleanGeneratedTitle("A".repeat(100));
  assert.equal(title.length, 80);
  assert.ok(title.endsWith("..."));
});

test("generateChatTitle uses a bounded prompt and 24 output tokens", async () => {
  let receivedInput = "";
  let receivedMaxTokens = 0;
  const adapter = {
    complete: async (messages, _signal, maxOutputTokens) => {
      receivedInput = messages.at(-1)?.content || "";
      receivedMaxTokens = maxOutputTokens || 0;
      return "Judul Percakapan";
    },
  } as ProviderAdapter;

  assert.equal(await generateChatTitle(adapter, "A".repeat(4_000)), "Judul Percakapan");
  assert.equal(receivedInput.length, 2_000);
  assert.equal(receivedMaxTokens, 24);
});
