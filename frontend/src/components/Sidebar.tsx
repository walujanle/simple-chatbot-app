import { memo, useCallback, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { formatDate, truncate } from "@/lib/utils";
import type { Chat } from "@/types";

interface SidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  isOpen,
  onToggle,
  onOpenSettings,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filteredChats = useMemo(
    () => chats.filter((chat) => chat.title.toLowerCase().includes(searchQuery.toLowerCase())),
    [chats, searchQuery],
  );

  const handleRenameStart = useCallback((chat: Chat) => {
    setRenamingId(chat.id);
    setRenameValue(chat.title);
  }, []);

  const handleRenameConfirm = useCallback(
    (chatId: string) => {
      if (renameValue.trim()) {
        onRenameChat(chatId, renameValue.trim());
      }
      setRenamingId(null);
    },
    [renameValue, onRenameChat],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, chatId: string) => {
      if (e.key === "Enter") handleRenameConfirm(chatId);
      if (e.key === "Escape") setRenamingId(null);
    },
    [handleRenameConfirm],
  );

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-dvh w-[min(18rem,88vw)] min-h-0 flex-col border-r border-white/10 bg-surface-900/95 backdrop-blur-xl transition-transform duration-300 md:relative ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 text-white/60"
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
              <span className="font-semibold text-white">Chats</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onNewChat}
                className="w-8 h-8 rounded-lg bg-white hover:bg-gray-200 text-black flex items-center justify-center transition-colors"
                title="New Chat"
                aria-label="New chat"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="md:hidden w-8 h-8 rounded-lg border border-white/10 hover:bg-white/5 text-white/60 flex items-center justify-center transition-colors"
                title="Close Sidebar"
                aria-label="Close sidebar"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative">
            <svg
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              aria-label="Search conversations"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-surface-800 border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {filteredChats.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-white/40">{searchQuery ? "No chats found" : "No conversations yet"}</p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="mt-2 text-sm text-white/60 hover:text-white transition-colors"
                >
                  Start a new chat
                </button>
              )}
            </div>
          ) : (
            filteredChats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                activeChatId={activeChatId}
                renamingId={renamingId}
                renameValue={renameValue}
                onSelect={onSelectChat}
                onDelete={onDeleteChat}
                onRenameStart={handleRenameStart}
                onRenameChange={setRenameValue}
                onRenameConfirm={handleRenameConfirm}
                onKeyDown={handleKeyDown}
              />
            ))
          )}
        </div>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
                <span className="text-sm font-semibold text-white/80">{user?.username?.charAt(0).toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                title="Settings"
                aria-label="Open settings"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.28z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={logout}
                className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

interface ChatItemProps {
  chat: Chat;
  activeChatId: string | null;
  renamingId: string | null;
  renameValue: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameStart: (chat: Chat) => void;
  onRenameChange: (val: string) => void;
  onRenameConfirm: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent, id: string) => void;
}

const ChatItem = memo(function ChatItem({
  chat,
  activeChatId,
  renamingId,
  renameValue,
  onSelect,
  onDelete,
  onRenameStart,
  onRenameChange,
  onRenameConfirm,
  onKeyDown,
}: ChatItemProps) {
  const isActive = activeChatId === chat.id;
  const isRenaming = renamingId === chat.id;

  return (
    <div
      className={`group relative rounded-xl cursor-pointer transition-all duration-200 ${
        isActive ? "bg-white/5 border border-white/10" : "hover:bg-white/3 border border-transparent"
      }`}
    >
      {isRenaming ? (
        <div className="p-3">
          <input
            type="text"
            value={renameValue}
            maxLength={120}
            aria-label={`Rename ${chat.title}`}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={() => onRenameConfirm(chat.id)}
            onKeyDown={(e) => onKeyDown(e, chat.id)}
            className="w-full bg-surface-800 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : (
        <button type="button" onClick={() => onSelect(chat.id)} className="w-full text-left p-3">
          <p className="text-sm font-medium text-white truncate pr-20">{truncate(chat.title, 40)}</p>
          <p className="text-xs text-white/40 mt-1">{formatDate(chat.updated_at)}</p>
        </button>
      )}

      <div className="absolute top-1/2 -translate-y-1/2 right-2 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-30 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRenameStart(chat);
          }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          title="Rename"
          aria-label={`Rename ${chat.title}`}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(chat.id);
          }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          title="Delete"
          aria-label={`Delete ${chat.title}`}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
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
      </div>
    </div>
  );
});
