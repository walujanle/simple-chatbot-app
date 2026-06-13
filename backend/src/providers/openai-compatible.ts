import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config as appConfig } from "@/config.js";
import type {
  GenerationEvent,
  GenerationRequest,
  ModelMessage,
  ProviderAdapter,
  ProviderCredential,
} from "@/providers/types.js";
import { secureExternalFetch } from "@/utils/network.js";

function toOpenAIMessages(messages: ModelMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly #client: OpenAI;

  constructor(private readonly config: ProviderCredential) {
    this.#client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || "https://api.openai.com/v1",
      timeout: appConfig.PROVIDER_TIMEOUT_MS,
      maxRetries: 2,
      fetch: secureExternalFetch,
    });
  }

  async *stream(request: GenerationRequest): AsyncGenerator<GenerationEvent> {
    const reasoningEffort =
      request.reasoning && this.config.reasoningEffort !== "off" ? this.config.reasoningEffort : "none";
    const modernRequest = {
      model: this.config.model,
      messages: toOpenAIMessages(request.messages),
      stream: true,
      temperature: this.config.temperature,
      max_completion_tokens: this.config.maxOutputTokens,
      reasoning_effort: reasoningEffort,
      stream_options: { include_usage: true },
    } as const;
    const createCompletion = async () => {
      try {
        return await this.#client.chat.completions.create(modernRequest, { signal: request.signal });
      } catch (error) {
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        if (status !== 400 && status !== 422) throw error;
        return this.#client.chat.completions.create(
          {
            model: this.config.model,
            messages: toOpenAIMessages(request.messages),
            stream: true,
            temperature: this.config.temperature,
            max_tokens: this.config.maxOutputTokens,
          },
          { signal: request.signal },
        );
      }
    };
    const completion = await createCompletion();

    for await (const chunk of completion) {
      if (chunk.usage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
      const delta = chunk.choices[0]?.delta as
        | { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
        | undefined;
      const reasoning = delta?.reasoning_content || delta?.reasoning;
      if (request.reasoning && reasoning) {
        yield { type: "reasoning", text: reasoning };
      }
      if (delta?.content) {
        yield { type: "content", text: delta.content };
      }
    }
  }

  async complete(messages: ModelMessage[], signal?: AbortSignal, maxOutputTokens = 1024): Promise<string> {
    const input = {
      model: this.config.model,
      messages: toOpenAIMessages(messages),
      temperature: 0.2,
      max_completion_tokens: Math.min(maxOutputTokens, this.config.maxOutputTokens),
    };
    const createCompletion = async () => {
      try {
        return await this.#client.chat.completions.create(input, { signal });
      } catch (error) {
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        if (status !== 400 && status !== 422) throw error;
        return this.#client.chat.completions.create(
          { ...input, max_completion_tokens: undefined, max_tokens: input.max_completion_tokens },
          { signal },
        );
      }
    };
    const completion = await createCompletion();
    return completion.choices[0]?.message.content?.trim() || "";
  }

  async validate(signal?: AbortSignal): Promise<void> {
    const input = {
      model: this.config.model,
      messages: [{ role: "user" as const, content: "Reply with OK." }],
      temperature: 0,
      max_completion_tokens: 8,
    };
    try {
      await this.#client.chat.completions.create(input, { signal });
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      if (status !== 400 && status !== 422) throw error;
      await this.#client.chat.completions.create(
        { ...input, max_completion_tokens: undefined, max_tokens: input.max_completion_tokens },
        { signal },
      );
    }
  }
}
