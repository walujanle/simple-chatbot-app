import type { ColumnType, Generated } from "kysely";
import type { AIProvider, ReasoningEffort } from "@/providers/types.js";

type Timestamp = ColumnType<string, string | undefined, string>;

export interface UsersTable {
  id: Generated<number>;
  username: string;
  username_normalized: string;
  password: string;
  system_prompt: string | null;
  temperature: number;
  max_tokens: number;
  session_version: number;
  credential_reset_required: number;
  active_provider: AIProvider | null;
  created_at: Timestamp;
}

export interface ChatsTable {
  id: string;
  user_id: number;
  title: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  summary: string | null;
  summary_through_message_id: number | null;
}

export interface MessagesTable {
  id: Generated<number>;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "completed" | "interrupted";
  error_code: string | null;
  created_at: Timestamp;
}

export interface ProviderConfigsTable {
  user_id: number;
  provider: AIProvider;
  api_key_encrypted: string;
  base_url: string | null;
  api_version: string | null;
  model: string;
  context_window: number;
  max_output_tokens: number;
  temperature: number;
  reasoning_effort: ReasoningEffort;
  is_active: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MessageReceiptsTable {
  message_id: number;
  provider: AIProvider;
  model: string;
  endpoint_host: string | null;
  latency_ms: number;
  web_search_used: number;
  search_query: string | null;
  sources_json: string;
  reasoning_enabled: number;
  reasoning_effort: ReasoningEffort;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  estimated_input_tokens: number | null;
  summarized_count: number;
  recent_count: number;
  created_at: Timestamp;
}

export interface AppMetadataTable {
  key: string;
  value: string;
  updated_at: Timestamp;
}

export interface DatabaseSchema {
  users: UsersTable;
  chats: ChatsTable;
  messages: MessagesTable;
  provider_configs: ProviderConfigsTable;
  message_receipts: MessageReceiptsTable;
  app_metadata: AppMetadataTable;
}
