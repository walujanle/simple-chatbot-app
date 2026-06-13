import type {
  GenerationEvent,
  GenerationRequest,
  ModelMessage,
  ProviderAdapter,
  ProviderCredential,
} from "@/providers/types.js";
import { secureExternalFetch } from "@/utils/network.js";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;

function splitMessages(messages: ModelMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
  return { system, contents };
}

function thinkingBudget(effort: ProviderCredential["reasoningEffort"]): number {
  if (effort === "low") return 1024;
  if (effort === "medium") return 4096;
  if (effort === "high") return 8192;
  return 0;
}

function thinkingConfig(model: string, effort: ProviderCredential["reasoningEffort"], enabled: boolean) {
  if (model.toLowerCase().startsWith("gemini-3")) {
    return { includeThoughts: enabled, thinkingLevel: enabled ? effort : "minimal" };
  }
  return { includeThoughts: enabled, thinkingBudget: enabled ? thinkingBudget(effort) : 0 };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("Provider response exceeded the size limit");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Provider response exceeded the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseJsonResponse(response: Response): Promise<GeminiResponse> {
  const body = await readBoundedText(response, MAX_JSON_RESPONSE_BYTES);
  if (!response.ok) throw new Error(`Gemini provider returned HTTP ${response.status}`);
  return JSON.parse(body) as GeminiResponse;
}

async function* parseEventStream(response: Response): AsyncGenerator<GeminiResponse> {
  if (!response.ok) {
    await readBoundedText(response, MAX_JSON_RESPONSE_BYTES);
    throw new Error(`Gemini provider returned HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Gemini provider returned no response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  const maxBytes = 16 * 1024 * 1024;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Provider stream exceeded the size limit");
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") yield JSON.parse(data) as GeminiResponse;
    }
  }

  buffer += decoder.decode();
  const data = buffer
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (data && data !== "[DONE]") yield JSON.parse(data) as GeminiResponse;
}

export class GeminiAdapter implements ProviderAdapter {
  constructor(private readonly config: ProviderCredential) {}

  #endpoint(method: "generateContent" | "streamGenerateContent"): string {
    const url = new URL(this.config.baseUrl || "https://generativelanguage.googleapis.com");
    const version = this.config.apiVersion || "v1beta";
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath.endsWith(`/${version}`) ? basePath : `${basePath}/${version}`}/models/${encodeURIComponent(this.config.model)}:${method}`;
    url.search = method === "streamGenerateContent" ? "?alt=sse" : "";
    return url.href;
  }

  #body(messages: ModelMessage[], maxOutputTokens: number, reasoningEnabled: boolean) {
    const input = splitMessages(messages);
    return {
      contents: input.contents,
      ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
      generationConfig: {
        temperature: reasoningEnabled ? this.config.temperature : Math.min(this.config.temperature, 0.2),
        maxOutputTokens,
        thinkingConfig: thinkingConfig(this.config.model, this.config.reasoningEffort, reasoningEnabled),
      },
    };
  }

  #request(method: "generateContent" | "streamGenerateContent", body: object, signal?: AbortSignal) {
    return secureExternalFetch(this.#endpoint(method), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey },
      body: JSON.stringify(body),
      signal,
    });
  }

  async *stream(request: GenerationRequest): AsyncGenerator<GenerationEvent> {
    const reasoningEnabled = request.reasoning && this.config.reasoningEffort !== "off";
    const response = await this.#request(
      "streamGenerateContent",
      this.#body(request.messages, this.config.maxOutputTokens, reasoningEnabled),
      request.signal,
    );
    for await (const chunk of parseEventStream(response)) {
      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        if (!part.text) continue;
        if (part.thought) {
          if (reasoningEnabled) yield { type: "reasoning", text: part.text };
        } else {
          yield { type: "content", text: part.text };
        }
      }
      if (chunk.usageMetadata) {
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
            reasoningTokens: chunk.usageMetadata.thoughtsTokenCount,
            totalTokens: chunk.usageMetadata.totalTokenCount,
          },
        };
      }
    }
  }

  async complete(messages: ModelMessage[], signal?: AbortSignal, maxOutputTokens = 1024): Promise<string> {
    const response = await this.#request(
      "generateContent",
      this.#body(messages, Math.min(maxOutputTokens, this.config.maxOutputTokens), false),
      signal,
    );
    const completion = await parseJsonResponse(response);
    return (completion.candidates?.[0]?.content?.parts || [])
      .filter((part) => !part.thought && part.text)
      .map((part) => part.text)
      .join("")
      .trim();
  }

  async validate(signal?: AbortSignal): Promise<void> {
    const response = await this.#request(
      "generateContent",
      this.#body([{ role: "user", content: "Reply with OK." }], 8, false),
      signal,
    );
    await parseJsonResponse(response);
  }
}
