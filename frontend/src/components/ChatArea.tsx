import { useCallback, useEffect, useRef } from "react";
import { MessageBubble, TypingIndicator } from "@/components/MessageBubble";
import type { Message } from "@/types";

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  isHistoryLoading: boolean;
  chatId: string | null;
  error: string | null;
}

export function ChatArea({ messages, isLoading, isHistoryLoading, chatId, error }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  useEffect(() => {
    void chatId;
    isNearBottomRef.current = true;
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [chatId]);

  useEffect(() => {
    void messages.length;
    if (isNearBottomRef.current || isLoading) {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: "auto" });
      }
    }
  }, [messages, isLoading]);

  if (!chatId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 sm:p-8">
        <div className="text-center max-w-md" role="alert">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white/5 mb-6">
            <svg
              aria-hidden="true"
              className="w-10 h-10 text-white/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Welcome to Simple Chatbot</h2>
          <p className="text-white/40 leading-relaxed">
            Select a conversation from the sidebar or start a new chat to begin.
          </p>
        </div>
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 sm:p-8">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 mb-4">
            <svg
              aria-hidden="true"
              className="w-8 h-8 text-white/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <p className="text-white/50">{error}</p>
        </div>
      </div>
    );
  }

  if (isHistoryLoading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-white/40" role="status">
        <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-current" />
        Loading conversation history
      </div>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      ref={containerRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-busy={isLoading || isHistoryLoading}
    >
      <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-4 md:p-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && !messages.some((message) => message.id === -1) && <TypingIndicator />}
        {error && (
          <div className="flex justify-center">
            <div role="alert" className="bg-white/5 border border-white/10 text-white/60 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
