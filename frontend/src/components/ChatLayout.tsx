import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { ChatArea } from "@/components/ChatArea";
import { MessageInput } from "@/components/MessageInput";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/hooks/useChat";
import { exportChatAsMarkdown } from "@/lib/export-chat";
import type { Chat } from "@/types";

type ProviderStatus = "loading" | "ready" | "missing" | "error";

export function ChatLayout() {
  const { user, clearCredentialResetNotice } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const { chatId } = useParams<{ chatId: string }>();
  const activeChatId = chatId || null;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusProviderKey, setFocusProviderKey] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>("loading");
  const [noticeError, setNoticeError] = useState<string | null>(null);

  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const activeChat = chats.find((chat) => chat.id === activeChatId);

  const { messages, setMessages, isLoading, isHistoryLoading, error, setError, sendMessage } = useChat(activeChatId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setActiveChat = useCallback(
    (id: string | null) => {
      if (id) {
        navigate(`/c/${id}`);
      } else {
        navigate("/");
      }
    },
    [navigate],
  );

  const loadChats = useCallback(async () => {
    try {
      const data = await api.getChats();
      if (mountedRef.current) setChats(data.chats);
    } catch {
      if (mountedRef.current) setError("Failed to load conversations");
    }
  }, [setError]);

  const loadProviderStatus = useCallback(async () => {
    setProviderStatus("loading");
    try {
      const data = await api.getProviders();
      if (!mountedRef.current) return;
      const hasActiveProvider = data.providers.some((provider) => provider.isActive && provider.hasApiKey);
      setProviderStatus(hasActiveProvider ? "ready" : "missing");
    } catch {
      if (mountedRef.current) setProviderStatus("error");
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadChats(), loadProviderStatus()]);
  }, [loadChats, loadProviderStatus]);

  const openSettings = useCallback((focusApiKey = false) => {
    setFocusProviderKey(focusApiKey);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setFocusProviderKey(false);
    void loadProviderStatus();
  }, [loadProviderStatus]);

  const handleProviderStatusChange = useCallback(
    (ready: boolean) => {
      setProviderStatus(ready ? "ready" : "missing");
      if (ready) setError(null);
    },
    [setError],
  );

  const handleNewChat = useCallback(async () => {
    api.cancelActiveStream();
    try {
      const data = await api.createChat();
      if (!mountedRef.current) return;
      const newChat: Chat = { ...data.chat, message_count: 0 };
      setChats((prev) => [newChat, ...prev]);
      setActiveChat(data.chat.id);
      setSidebarOpen(false);
    } catch {
      if (mountedRef.current) setError("Failed to create new chat");
    }
  }, [setActiveChat, setError]);

  const handleSelectChat = useCallback(
    (chatId: string) => {
      api.cancelActiveStream();
      setActiveChat(chatId);
      if (mountedRef.current) setSidebarOpen(false);
    },
    [setActiveChat],
  );

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      const chat = chats.find((candidate) => candidate.id === chatId);
      if (!window.confirm(`Delete "${chat?.title || "this conversation"}"? This action cannot be undone.`)) return;
      try {
        await api.deleteChat(chatId);
        if (!mountedRef.current) return;
        setChats((prev) => prev.filter((c) => c.id !== chatId));
        if (activeChatId === chatId) {
          setActiveChat(null);
          setMessages([]);
        }
      } catch {
        if (mountedRef.current) setError("Failed to delete chat");
      }
    },
    [activeChatId, chats, setActiveChat, setError, setMessages],
  );

  const handleRenameChat = useCallback(
    async (chatId: string, title: string) => {
      try {
        const data = await api.renameChat(chatId, title);
        if (mountedRef.current) {
          setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: data.chat.title } : c)));
        }
      } catch {
        if (mountedRef.current) setError("Failed to rename chat");
      }
    },
    [setError],
  );

  const handleSendMessage = useCallback(
    async (content: string, options?: { webSearch?: boolean; thinking?: boolean }) => {
      if (providerStatus === "missing") {
        openSettings(true);
        return;
      }
      if (!activeChatId) {
        api.cancelActiveStream();
        try {
          const title = content.length > 30 ? `${content.slice(0, 30)}...` : content;
          const data = await api.createChat(title);
          if (!mountedRef.current) return;
          const newChat: Chat = { ...data.chat, message_count: 0 };
          setChats((prev) => [newChat, ...prev]);

          setActiveChat(data.chat.id);
          void sendMessage(content, options, data.chat.id).then(loadChats);
        } catch {
          if (mountedRef.current) setError("Failed to create new chat");
        }
      } else {
        void sendMessage(content, options).then(loadChats);
      }
    },
    [activeChatId, loadChats, openSettings, providerStatus, sendMessage, setActiveChat, setError],
  );

  const dismissCredentialResetNotice = useCallback(async () => {
    setNoticeError(null);
    try {
      await clearCredentialResetNotice();
    } catch {
      setNoticeError("Could not dismiss this notification. Please try again.");
    }
  }, [clearCredentialResetNotice]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-surface">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={() => openSettings(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-surface/80 px-3 py-3 backdrop-blur-xl sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="md:hidden p-2 rounded-lg hover:bg-white/5 text-white/60 transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-medium text-white truncate">{activeChat?.title || "Simple Chatbot"}</h1>
          </div>

          {activeChatId && (
            <>
              <button
                type="button"
                onClick={() => exportChatAsMarkdown(activeChat?.title || "Conversation", messages)}
                disabled={messages.length === 0}
                className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Export chat as Markdown"
                title="Export chat"
              >
                <svg
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 15v4h14v-4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleDeleteChat(activeChatId)}
                className="p-2 rounded-lg hover:bg-white/5 text-white/60 hover:text-red-400 transition-colors"
                aria-label="Delete Chat"
                title="Delete chat"
              >
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
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleNewChat}
                className="p-2 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-colors"
                aria-label="New Chat"
              >
                <svg
                  aria-hidden="true"
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </>
          )}
        </header>

        {user?.credentialResetRequired && (
          <div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100" role="alert">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1">
                The system encryption identity changed or stored credentials became unreadable. Affected AI credentials
                were deleted automatically and must be added again.
                {noticeError && <span className="mt-1 block text-red-300">{noticeError}</span>}
              </p>
              <button
                type="button"
                onClick={() => openSettings(true)}
                className="rounded-lg bg-amber-100 px-3 py-1.5 font-medium text-amber-950 hover:bg-white"
              >
                Configure credentials
              </button>
              <button
                type="button"
                onClick={() => void dismissCredentialResetNotice()}
                className="rounded-lg border border-amber-200/20 px-3 py-1.5 text-amber-100 hover:bg-amber-100/10"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <ChatArea
          messages={messages}
          isLoading={isLoading}
          isHistoryLoading={isHistoryLoading}
          chatId={activeChatId}
          error={error}
          needsProviderSetup={providerStatus === "missing"}
          onConfigureProvider={() => openSettings(true)}
        />

        <MessageInput
          onSend={handleSendMessage}
          isLoading={isLoading || isHistoryLoading}
          isHistoryLoading={isHistoryLoading}
          onCancel={() => api.cancelActiveStream()}
          providerSetupRequired={providerStatus === "missing"}
          providerStatusLoading={providerStatus === "loading"}
        />
      </div>
      {settingsOpen && (
        <SettingsModal
          onClose={closeSettings}
          focusApiKey={focusProviderKey}
          onProviderStatusChange={handleProviderStatusChange}
        />
      )}
    </div>
  );
}
