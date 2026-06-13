import assert from "node:assert/strict";
import crypto from "node:crypto";
import { insertMessage, insertUser } from "@/database/write.js";
import db, { closeDatabase, nowIso } from "@/db.js";

const username = `database_smoke_${crypto.randomBytes(8).toString("hex")}`;
let userId: number | undefined;

try {
  userId = await insertUser(db, {
    username,
    username_normalized: username,
    password: "not-a-real-password-hash",
    system_prompt: null,
    temperature: 0.7,
    max_tokens: 2048,
    session_version: 0,
    credential_reset_required: 0,
    active_provider: null,
    created_at: nowIso(),
  });
  const chatId = crypto.randomUUID();
  const timestamp = nowIso();
  await db
    .insertInto("chats")
    .values({
      id: chatId,
      user_id: userId,
      title: "Database smoke test",
      created_at: timestamp,
      updated_at: timestamp,
      summary: null,
      summary_through_message_id: null,
    })
    .execute();
  const messageId = await insertMessage(db, {
    chat_id: chatId,
    role: "user",
    content: "Portable database verification",
    status: "completed",
    error_code: null,
    created_at: timestamp,
  });
  const stored = await db
    .selectFrom("messages")
    .innerJoin("chats", "chats.id", "messages.chat_id")
    .select(["messages.id", "messages.content", "chats.user_id"])
    .where("messages.id", "=", messageId)
    .executeTakeFirstOrThrow();
  assert.equal(stored.content, "Portable database verification");
  assert.equal(stored.user_id, userId);
  process.stdout.write("Database smoke test passed.\n");
} finally {
  if (userId !== undefined) await db.deleteFrom("users").where("id", "=", userId).execute();
  await closeDatabase();
}
