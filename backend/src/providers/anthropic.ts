import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import { config as appConfig } from "@/config.js";
import type {
  GenerationEvent,
  GenerationRequest,
  ModelMessage,
  ProviderAdapter,
  ProviderCredential,
} from "@/providers/types.js";
import { secureExternalFetch } from "@/utils/network.js";

function splitMessages(messages: ModelMessage[]): { system: string; messages: MessageParam[] } {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }) as MessageParam);
  return { system, messages: conversation };
}

function toAnthropicEffort(effort: ProviderCredential["reasoningEffort"]): "low" | "medium" | "high" {
  if (effort === "low" || effort === "high") return effort;
  return "medium";
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly #client: Anthropic;

  constructor(private readonly config: ProviderCredential) {
    this.#client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: appConfig.PROVIDER_TIMEOUT_MS,
      maxRetries: 2,
      fetch: secureExternalFetch,
    });
  }

  async *stream(request: GenerationRequest): AsyncGenerator<GenerationEvent> {
    const { system, messages } = splitMessages(request.messages);
    const thinkingEnabled = request.reasoning && this.config.reasoningEffort !== "off";
    const effort = toAnthropicEffort(this.config.reasoningEffort);
    const stream = await this.#client.messages.create(
      {
        model: this.config.model,
        system,
        messages,
        max_tokens: this.config.maxOutputTokens,
        stream: true,
        ...(thinkingEnabled
          ? {
              thinking: { type: "adaptive" as const, display: "summarized" as const },
              output_config: { effort },
            }
          : {}),
      },
      { signal: request.signal },
    );

    for await (const event of stream as AsyncIterable<MessageStreamEvent>) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "content", text: event.delta.text };
        } else if (thinkingEnabled && event.delta.type === "thinking_delta") {
          yield { type: "reasoning", text: event.delta.thinking };
        }
      } else if (event.type === "message_start") {
        yield {
          type: "usage",
          usage: {
            inputTokens: event.message.usage.input_tokens,
            outputTokens: event.message.usage.output_tokens,
          },
        };
      } else if (event.type === "message_delta") {
        yield {
          type: "usage",
          usage: {
            outputTokens: event.usage.output_tokens,
            reasoningTokens: event.usage.output_tokens_details?.thinking_tokens,
          },
        };
      }
    }
  }

  async complete(messages: ModelMessage[], signal?: AbortSignal, maxOutputTokens = 1024): Promise<string> {
    const input = splitMessages(messages);
    const completion = await this.#client.messages.create(
      {
        model: this.config.model,
        system: input.system,
        messages: input.messages,
        max_tokens: Math.min(maxOutputTokens, this.config.maxOutputTokens),
      },
      { signal },
    );
    return completion.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }

  async validate(signal?: AbortSignal): Promise<void> {
    await this.#client.messages.create(
      {
        model: this.config.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
      },
      { signal },
    );
  }
}
