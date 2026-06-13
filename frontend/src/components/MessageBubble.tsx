import { memo, useCallback, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ResponseReceipt } from "@/components/ResponseReceipt";
import { cn } from "@/lib/utils";
import type { Message, MessageStatus } from "@/types";

const STATUS_LABELS: Partial<Record<MessageStatus, string>> = {
  preparing: "Preparing context",
  searching: "Searching the web",
  search_complete: "Web search completed",
  search_unavailable: "Web search unavailable; continuing without it",
  summarizing: "Compressing earlier conversation",
  thinking: "Reasoning",
  generating: "Generating response",
};

export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const toggleReasoning = useCallback(() => setReasoningOpen((current) => !current), []);
  if (message.role === "system") return null;

  const liveStatus = message.status && STATUS_LABELS[message.status];
  return (
    <div className={cn("message-enter flex w-full min-w-0 gap-2 sm:gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <Avatar label="AI" />}
      <div
        className={cn(
          "min-w-0 max-w-[calc(100%-2.5rem)] rounded-2xl border px-3 py-3 sm:px-4 md:max-w-[78%]",
          isUser ? "rounded-br-md border-white/10 bg-white/10" : "rounded-bl-md border-white/10 bg-surface-800/60",
        )}
      >
        {liveStatus && (
          <div
            className={cn(
              "mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
              message.status === "search_unavailable"
                ? "border-amber-500/20 bg-amber-500/5 text-amber-300"
                : "border-white/10 bg-white/5 text-white/50",
            )}
          >
            {message.status !== "search_unavailable" && (
              <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
            )}
            <span>
              {liveStatus}
              {message.status === "searching" && message.searchQuery ? `: ${message.searchQuery}` : ""}
            </span>
          </div>
        )}

        {message.reasoning && (
          <div className="mb-3 overflow-hidden rounded-xl border border-purple-500/15 bg-purple-500/5">
            <button
              type="button"
              onClick={toggleReasoning}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-purple-300/80 hover:bg-purple-500/5"
            >
              <span>{message.status === "thinking" ? "Reasoning summary (live)" : "Reasoning summary"}</span>
              <span className="ml-auto">{reasoningOpen ? "Hide" : "Show"}</span>
            </button>
            {(reasoningOpen || message.status === "thinking") && (
              <div className="max-h-72 overflow-y-auto border-t border-purple-500/10 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-white/45">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {!isUser && message.searchSourceCount !== undefined && (
          <div className="mb-3 rounded-lg border border-blue-500/15 bg-blue-500/5 px-3 py-2 text-xs text-blue-300/80">
            Web search used {message.searchSourceCount} source{message.searchSourceCount === 1 ? "" : "s"}
            {message.searchQuery ? ` for "${message.searchQuery}"` : ""}.
          </div>
        )}

        {!isUser && message.searchUnavailable && (
          <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            Web search was requested but no usable results were available.
          </div>
        )}

        {message.status === "interrupted" && (
          <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            This response was interrupted and may be incomplete.
          </div>
        )}
        {message.content && <MarkdownRenderer content={message.content} />}
        {!isUser && message.receipt && <ResponseReceipt receipt={message.receipt} content={message.content} />}
      </div>
      {isUser && <Avatar label="You" />}
    </div>
  );
});

function Avatar({ label }: { label: string }) {
  return (
    <div
      title={label}
      className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[10px] font-semibold text-white/60 sm:flex"
    >
      {label === "AI" ? "AI" : "U"}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="message-enter flex w-full gap-3">
      <Avatar label="AI" />
      <div className="rounded-2xl rounded-bl-md border border-white/10 bg-surface-800/60 px-4 py-4">
        <div className="flex gap-1.5">
          <div className="typing-dot" />
          <div className="typing-dot" />
          <div className="typing-dot" />
        </div>
      </div>
    </div>
  );
}
