import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

interface MessageInputProps {
  onSend: (content: string, options?: { webSearch?: boolean; thinking?: boolean }) => void;
  isLoading: boolean;
  isHistoryLoading?: boolean;
  onCancel: () => void;
  providerSetupRequired?: boolean;
  providerStatusLoading?: boolean;
}

export function MessageInput({
  onSend,
  isLoading,
  isHistoryLoading = false,
  onCancel,
  providerSetupRequired = false,
  providerStatusLoading = false,
}: MessageInputProps) {
  const [input, setInput] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [thinking, setThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputBlocked = providerSetupRequired || providerStatusLoading;

  useEffect(() => {
    if (!isLoading && !inputBlocked && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [inputBlocked, isLoading]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => {
    void input;
    adjustHeight();
  }, [input, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || inputBlocked) return;
    onSend(trimmed, { webSearch, thinking });
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, inputBlocked, isLoading, onSend, webSearch, thinking]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const toggleWebSearch = useCallback(() => {
    setWebSearch((current) => !current);
  }, []);

  const toggleThinking = useCallback(() => {
    setThinking((current) => !current);
  }, []);

  return (
    <div className="shrink-0 border-t border-white/10 bg-surface/95 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-5xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          <button
            type="button"
            onClick={toggleWebSearch}
            disabled={isLoading || inputBlocked}
            aria-pressed={webSearch}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
              webSearch
                ? "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_12px_rgba(59,130,246,0.1)]"
                : "bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/70"
            }`}
          >
            <svg
              aria-hidden="true"
              className={`w-3.5 h-3.5 ${webSearch ? "animate-[spin_6s_linear_infinite]" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.905 0-5.62-.73-8.005-2.02m16.01 0a8.969 8.969 0 01-.702 3.518M3.995 8.482a8.969 8.969 0 00.702 3.518M12 10.5a11.947 11.947 0 012.283 5.378m-4.566 0A11.947 11.947 0 0112 10.5m0 0a11.953 11.953 0 008.005-2.02M12 10.5a11.953 11.953 0 01-8.005-2.02"
              />
            </svg>
            <span>Search the Web</span>
          </button>

          <button
            type="button"
            onClick={toggleThinking}
            disabled={isLoading || inputBlocked}
            aria-pressed={thinking}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
              thinking
                ? "bg-purple-500/10 text-purple-400 border-purple-500/20 shadow-[0_0_12px_rgba(168,85,247,0.1)]"
                : "bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/70"
            }`}
          >
            <svg
              aria-hidden="true"
              className={`w-3.5 h-3.5 ${thinking ? "animate-pulse" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
            <span>Reasoning</span>
          </button>
        </div>

        <div className="glass flex min-w-0 items-end gap-2 rounded-2xl p-2 sm:gap-3 transition-all duration-200 focus-within:border-white/20 focus-within:ring-1 focus-within:ring-white/10">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              providerSetupRequired
                ? "Configure an AI provider to start chatting"
                : providerStatusLoading
                  ? "Checking AI provider configuration..."
                  : isHistoryLoading
                    ? "Loading conversation history..."
                    : "Type your message... (Shift+Enter for new line)"
            }
            rows={1}
            maxLength={32000}
            disabled={isLoading || inputBlocked}
            className="max-h-50 min-w-0 flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm leading-relaxed text-white placeholder:text-white/30 disabled:opacity-50 sm:px-3 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          />

          <button
            onClick={isLoading && !isHistoryLoading ? onCancel : handleSend}
            disabled={isHistoryLoading || inputBlocked || (!isLoading && !input.trim())}
            type="button"
            aria-label={
              isHistoryLoading ? "Loading conversation history" : isLoading ? "Stop response" : "Send message"
            }
            className="flex items-center justify-center h-10 w-10 shrink-0 rounded-xl bg-white text-black transition-all duration-200 hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-surface-700 disabled:text-surface-500 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-800 cursor-pointer"
          >
            {isLoading && !isHistoryLoading ? (
              <span className="h-3.5 w-3.5 rounded-sm bg-current" />
            ) : (
              <svg
                aria-hidden="true"
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
