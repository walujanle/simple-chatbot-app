import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/api/client";
import type { Message, MessageStatus, ResponseReceipt } from "@/types";

export function useChat(activeChatId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeChatRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const loadedChatRef = useRef<string | null>(null);
  const historyPromiseRef = useRef<Promise<void> | null>(null);
  const historyRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      api.cancelActiveStream();
    };
  }, []);

  useEffect(() => {
    const isPreparedChat = Boolean(
      activeChatId && activeChatRef.current === activeChatId && loadedChatRef.current === activeChatId,
    );

    if (!isPreparedChat) {
      api.cancelActiveStream();
      setIsLoading(false);
      setError(null);
    }
    activeChatRef.current = activeChatId;

    if (!activeChatId) {
      loadedChatRef.current = null;
      historyPromiseRef.current = null;
      setIsHistoryLoading(false);
      setMessages([]);
      return;
    }

    if (loadedChatRef.current === activeChatId) return;

    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    setIsHistoryLoading(true);
    setMessages([]);
    const historyPromise = api
      .getChat(activeChatId)
      .then((data) => {
        if (!mountedRef.current || activeChatRef.current !== activeChatId || historyRequestRef.current !== requestId)
          return;
        loadedChatRef.current = activeChatId;
        setMessages((current) => {
          const optimistic = current.filter((message) => message.id < 0);
          return optimistic.length > 0 ? [...data.messages, ...optimistic] : data.messages;
        });
      })
      .catch((caught: unknown) => {
        if (
          mountedRef.current &&
          activeChatRef.current === activeChatId &&
          historyRequestRef.current === requestId &&
          (!(caught instanceof ApiError) || caught.code !== "ABORT_ERROR")
        ) {
          setError(caught instanceof ApiError ? caught.message : "Failed to load messages");
        }
      })
      .finally(() => {
        if (mountedRef.current && activeChatRef.current === activeChatId && historyRequestRef.current === requestId) {
          setIsHistoryLoading(false);
          historyPromiseRef.current = null;
        }
      });
    historyPromiseRef.current = historyPromise;

    return () => {
      historyRequestRef.current += 1;
      api.cancelRequest(`getChat:${activeChatId}`);
    };
  }, [activeChatId]);

  const sendMessage = useCallback(
    async (content: string, options?: { webSearch?: boolean; thinking?: boolean }, chatIdOverride?: string) => {
      const chatId = chatIdOverride || activeChatRef.current;
      if (!chatId) return;
      if (chatIdOverride) {
        activeChatRef.current = chatId;
        loadedChatRef.current = chatId;
        historyPromiseRef.current = null;
      } else if (historyPromiseRef.current) {
        await historyPromiseRef.current;
        if (!mountedRef.current || activeChatRef.current !== chatId) return;
      }

      const userTempId = -Date.now();
      setMessages((current) => [
        ...current,
        {
          id: userTempId,
          chat_id: chatId,
          role: "user",
          content,
          status: "completed",
          created_at: new Date().toISOString(),
        },
      ]);
      setIsLoading(true);
      setError(null);

      let contentBuffer = "";
      let reasoningBuffer = "";
      let currentStatus: MessageStatus = "preparing";
      let searchQuery: string | undefined;
      let searchSourceCount: number | undefined;
      let searchUnavailable = false;
      let receipt: ResponseReceipt | undefined;
      let assistantMessageId = -1;
      let persistedUserMessageId: number | undefined;
      let updateTimer: number | undefined;
      let lastUpdate = 0;
      const updateAssistant = () => {
        const snapshot: Message = {
          id: assistantMessageId,
          chat_id: chatId,
          role: "assistant",
          content: contentBuffer,
          reasoning: reasoningBuffer || undefined,
          status: currentStatus,
          searchQuery,
          searchSourceCount,
          searchUnavailable,
          receipt,
          created_at: new Date().toISOString(),
        };
        setMessages((current) => {
          const withoutStream = current.filter((message) => message.id !== -1 && message.id !== assistantMessageId);
          return [...withoutStream, snapshot];
        });
        lastUpdate = performance.now();
      };
      const scheduleUpdate = (force = false) => {
        const elapsed = performance.now() - lastUpdate;
        if (force || elapsed >= 40) {
          if (updateTimer) window.clearTimeout(updateTimer);
          updateTimer = undefined;
          updateAssistant();
        } else if (!updateTimer) {
          updateTimer = window.setTimeout(() => {
            updateTimer = undefined;
            if (mountedRef.current && activeChatRef.current === chatId) updateAssistant();
          }, 40 - elapsed);
        }
      };

      try {
        const result = await api.sendMessageStream(
          chatId,
          content,
          Boolean(options?.webSearch),
          Boolean(options?.thinking),
          (chunk) => {
            if (!mountedRef.current || activeChatRef.current !== chatId) return;
            if (chunk.status) currentStatus = chunk.status;
            if (chunk.query) searchQuery = chunk.query;
            if (chunk.sourceCount !== undefined) searchSourceCount = chunk.sourceCount;
            if (chunk.userMessageId !== undefined && persistedUserMessageId === undefined) {
              persistedUserMessageId = chunk.userMessageId;
              setMessages((current) =>
                current.map((message) =>
                  message.id === userTempId ? { ...message, id: chunk.userMessageId as number } : message,
                ),
              );
            }
            if (chunk.messageId !== undefined) assistantMessageId = chunk.messageId;
            if (chunk.receipt) receipt = chunk.receipt;
            if (chunk.status === "search_unavailable") searchUnavailable = true;
            if (chunk.content) contentBuffer += chunk.content;
            if (chunk.reasoning) reasoningBuffer += chunk.reasoning;
            if (chunk.error) setError(chunk.error);
            scheduleUpdate(Boolean(chunk.status && !chunk.content && !chunk.reasoning));
          },
        );
        if (!mountedRef.current || activeChatRef.current !== chatId) return;
        contentBuffer = result.fullContent;
        currentStatus = result.hadError ? "interrupted" : "completed";
        if (contentBuffer) scheduleUpdate(true);
        else setMessages((current) => current.filter((message) => message.id !== -1));
      } catch (caught) {
        if (!mountedRef.current || activeChatRef.current !== chatId) return;
        if (persistedUserMessageId === undefined) {
          setMessages((current) => current.filter((message) => message.id !== userTempId));
        }
        if (caught instanceof ApiError && caught.code === "ABORT_ERROR") {
          if (contentBuffer) {
            currentStatus = "interrupted";
            scheduleUpdate(true);
          } else {
            setMessages((current) => current.filter((message) => message.id !== -1));
          }
          return;
        }
        setError(caught instanceof ApiError ? caught.message : "Failed to send message");
        setMessages((current) => current.filter((message) => message.id !== -1));
      } finally {
        if (updateTimer) window.clearTimeout(updateTimer);
        if (mountedRef.current && activeChatRef.current === chatId) setIsLoading(false);
      }
    },
    [],
  );

  return { messages, setMessages, isLoading, isHistoryLoading, error, setError, sendMessage };
}
