import type { Chat, Message, ProviderConfig, ProviderConfigInput, StreamChunk, User } from "@/types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?chatbot_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "UNKNOWN_ERROR",
    public status = 500,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class ApiClient {
  private activeController: AbortController | null = null;
  private requestAbortControllers = new Map<string, AbortController>();

  cancelActiveStream(): void {
    this.activeController?.abort();
    this.activeController = null;
  }

  cancelRequest(key: string): void {
    this.requestAbortControllers.get(key)?.abort();
    this.requestAbortControllers.delete(key);
  }

  private async request<T>(path: string, options: RequestInit = {}, requestKey?: string): Promise<T> {
    let requestOptions = options;
    if (requestKey) {
      this.cancelRequest(requestKey);
      const controller = new AbortController();
      this.requestAbortControllers.set(requestKey, controller);
      requestOptions = { ...requestOptions, signal: controller.signal };
    }

    try {
      const method = (requestOptions.method || "GET").toUpperCase();
      const csrfHeaders: Record<string, string> = UNSAFE_METHODS.has(method) ? { "X-CSRF-Token": getCsrfToken() } : {};
      const response = await fetch(`${API_BASE}${path}`, {
        ...requestOptions,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders, ...requestOptions.headers },
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const error = new ApiError(
          errorBody?.error?.message || "Request failed",
          errorBody?.error?.code || "API_ERROR",
          response.status,
        );
        if (response.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
        throw error;
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new ApiError("Request was cancelled", "ABORT_ERROR", 0);
      throw new ApiError(error instanceof Error ? error.message : "Network request failed", "NETWORK_ERROR", 0);
    } finally {
      if (requestKey) this.requestAbortControllers.delete(requestKey);
    }
  }

  register(username: string, password: string): Promise<{ user: User }> {
    return this.request("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
  }

  getAuthConfig(): Promise<{ registrationEnabled: boolean }> {
    return this.request("/api/auth/config");
  }

  login(username: string, password: string): Promise<{ user: User }> {
    return this.request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  }

  logout(): Promise<{ success: boolean }> {
    return this.request("/api/auth/logout", { method: "POST" });
  }

  getProfile(): Promise<{ user: User & { system_prompt: string | null } }> {
    return this.request("/api/auth/profile", {}, "profile");
  }

  updateProfile(
    username: string,
    systemPrompt: string | null,
  ): Promise<{ user: User & { system_prompt: string | null } }> {
    return this.request("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ username, system_prompt: systemPrompt }),
    });
  }

  changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean }> {
    return this.request("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  getProviders(): Promise<{ providers: ProviderConfig[]; credentialResetRequired: boolean }> {
    return this.request("/api/providers", {}, "providers");
  }

  saveProvider(id: string | null, input: ProviderConfigInput): Promise<{ provider: ProviderConfig }> {
    if (id) {
      return this.request(`/api/providers/${id}`, { method: "PUT", body: JSON.stringify(input) });
    }
    return this.request("/api/providers", { method: "POST", body: JSON.stringify(input) });
  }

  testProvider(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/providers/${id}/test`, { method: "POST" });
  }

  activateProvider(id: string): Promise<{ success: boolean; provider: ProviderConfig }> {
    return this.request(`/api/providers/${id}/activate`, { method: "POST" });
  }

  deleteProvider(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/providers/${id}`, { method: "DELETE" });
  }

  deleteAllProviders(): Promise<{ success: boolean; deletedCount: number }> {
    return this.request("/api/providers", { method: "DELETE" });
  }

  acknowledgeCredentialReset(): Promise<{ success: boolean }> {
    return this.request("/api/providers/credential-reset/acknowledge", { method: "POST" });
  }

  getChats() {
    return this.request<{ chats: Chat[] }>("/api/chats", {}, "getChats");
  }

  createChat(title?: string) {
    return this.request<{ chat: Omit<Chat, "message_count"> }>("/api/chats", {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    });
  }

  getChat(chatId: string, requestKey?: string) {
    return this.request<{ chat: Omit<Chat, "message_count">; messages: Message[] }>(
      `/api/chats/${chatId}`,
      {},
      requestKey ?? `getChat:${chatId}`,
    );
  }

  deleteChat(chatId: string): Promise<{ success: boolean }> {
    return this.request(`/api/chats/${chatId}`, { method: "DELETE" });
  }

  renameChat(chatId: string, title: string) {
    return this.request<{ chat: Omit<Chat, "message_count"> }>(`/api/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  async sendMessageStream(
    chatId: string,
    content: string,
    webSearch: boolean,
    thinking: boolean,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<{ fullContent: string; hadError: boolean }> {
    this.cancelActiveStream();
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const response = await fetch(`${API_BASE}/api/chats/${chatId}/messages/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() },
        body: JSON.stringify({ content, webSearch, thinking }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        if (response.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
        throw new ApiError(
          errorBody?.error?.message || "Stream request failed",
          errorBody?.error?.code || "STREAM_ERROR",
          response.status,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError("Provider returned no response body", "NO_BODY");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let hadError = false;
      const processEvent = (eventText: string) => {
        for (const line of eventText.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          const chunk = JSON.parse(payload) as StreamChunk;
          if (chunk.content) fullContent += chunk.content;
          if (chunk.error) hadError = true;
          onChunk(chunk);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            processEvent(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processEvent(buffer);
        return { fullContent, hadError };
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new ApiError("Stream was cancelled", "ABORT_ERROR", 0);
      if (error instanceof ApiError) throw error;
      throw new ApiError(error instanceof Error ? error.message : "Stream failed", "STREAM_ERROR", 0);
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }
}

export const api = new ApiClient();
