import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "simple-chatbot-smoke-"));
const backendDirectory = path.join(root, "backend");
const smokeBackendDirectory = path.join(tempDirectory, "backend");
const databasePath = path.join(smokeBackendDirectory, "database", "chatbot.db");
const databaseUrl = process.env.SMOKE_DATABASE_URL || "";
const externalDatabase = Boolean(databaseUrl);
const frontendOrigin = "http://localhost:5173";
const alternateOrigin = "http://localhost:4173";
const backendRequire = createRequire(path.join(backendDirectory, "package.json"));
const Database = backendRequire("better-sqlite3");
const username = `smoke_${crypto.randomBytes(8).toString("hex")}`;

fs.mkdirSync(smokeBackendDirectory, { recursive: true });
fs.cpSync(path.join(backendDirectory, "dist"), path.join(smokeBackendDirectory, "dist"), { recursive: true });
fs.copyFileSync(path.join(backendDirectory, "package.json"), path.join(smokeBackendDirectory, "package.json"));
fs.symlinkSync(
  path.join(backendDirectory, "node_modules"),
  path.join(smokeBackendDirectory, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const port = await availablePort();
const environment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "production",
  PORT: String(port),
  FRONTEND_URL: `${frontendOrigin},${alternateOrigin}`,
  DATABASE_URL: databaseUrl,
  JWT_SECRET: crypto.randomBytes(32).toString("base64"),
  CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "Lax",
  REGISTRATION_ENABLED: "true",
  MAX_CHATS_PER_USER: "2",
  MAX_MESSAGES_PER_CHAT: "10",
};

Object.assign(process.env, environment);

const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: smokeBackendDirectory,
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
let parentDatabase = null;
child.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

const baseUrl = `http://127.0.0.1:${port}`;
let cookie = "";

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Origin", options.origin || frontendOrigin);
  if (options.body) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Backend did not become healthy:\n${serverOutput}`);
}

try {
  await waitForServer();

  const corsResponse = await request("/api/health", { origin: alternateOrigin });
  assert.equal(corsResponse.headers.get("access-control-allow-origin"), alternateOrigin);
  assert.ok(corsResponse.headers.get("x-request-id"));
  assert.equal(corsResponse.headers.get("cache-control"), "no-store");

  const authConfig = await request("/api/auth/config");
  assert.equal(authConfig.status, 200);
  assert.equal((await authConfig.json()).registrationEnabled, true);

  const oversizedPassword = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: "oversized_password", password: "a".repeat(73) }),
  });
  assert.equal(oversizedPassword.status, 400);

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "correct-horse-battery-staple" }),
  });
  assert.equal(registration.status, 201);
  const setCookie = registration.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /;\s*Secure/i);
  cookie = setCookie.split(";", 1)[0] || "";
  assert.ok(cookie.startsWith("chatbot_session="));

  const missingOrigin = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(missingOrigin.status, 403);

  const blockedOrigin = await request("/api/chats", {
    method: "POST",
    origin: "https://attacker.example",
    body: JSON.stringify({ title: "Blocked" }),
  });
  assert.equal(blockedOrigin.status, 403);

  const createChat = await request("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Release smoke test" }),
  });
  assert.equal(createChat.status, 201);
  const { chat } = await createChat.json();
  assert.ok(chat.id);

  const createMessage = await request(`/api/chats/${chat.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Verify persisted history" }),
  });
  assert.equal(createMessage.status, 200);

  const saveProvider = await request("/api/providers/anthropic", {
    method: "PUT",
    body: JSON.stringify({
      apiKey: "test-api-key-not-real",
      baseUrl: null,
      apiVersion: null,
      model: "claude-test",
      contextWindow: 8192,
      maxOutputTokens: 1024,
      temperature: 0.2,
      reasoningEffort: "off",
      isActive: true,
    }),
  });
  assert.equal(saveProvider.status, 200);
  const providerBody = await saveProvider.json();
  assert.equal(providerBody.provider.maskedApiKey, "Configured");
  assert.equal(JSON.stringify(providerBody).includes("test-api-key-not-real"), false);

  if (!externalDatabase) {
    const db = new Database(databasePath);
    parentDatabase = db;
    const storedUser = db.prepare("SELECT password FROM users WHERE username = ?").get(username);
    assert.match(storedUser.password, /^\$2[aby]\$12\$/);
    const assistant = db
      .prepare(
        "INSERT INTO messages (chat_id, role, content, status, error_code, created_at) VALUES (?, 'assistant', ?, 'completed', NULL, ?)",
      )
      .run(chat.id, "Persisted assistant response", new Date().toISOString());
    db.prepare(`
    INSERT INTO message_receipts (
      message_id, provider, model, endpoint_host, latency_ms, web_search_used,
      search_query, sources_json, reasoning_enabled, reasoning_effort,
      input_tokens, output_tokens, reasoning_tokens, total_tokens,
      estimated_input_tokens, summarized_count, recent_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assistant.lastInsertRowid,
      "anthropic",
      "claude-test",
      "api.anthropic.com",
      125,
      1,
      "release verification",
      JSON.stringify([
        {
          title: "Example source",
          url: "https://example.com/source",
          snippet: "Verification source",
          retrievedAt: new Date().toISOString(),
        },
      ]),
      0,
      "off",
      10,
      5,
      null,
      15,
      10,
      0,
      1,
      new Date().toISOString(),
    );
  }

  const getChat = await request(`/api/chats/${chat.id}`);
  assert.equal(getChat.status, 200);
  const chatBody = await getChat.json();
  assert.equal(chatBody.messages.length, externalDatabase ? 1 : 2);
  if (!externalDatabase) assert.equal(chatBody.messages.at(-1).receipt.sources.length, 1);

  if (!externalDatabase) {
    const db = parentDatabase;
    const insertHistory = db.transaction(() => {
      const statement = db.prepare(
        "INSERT INTO messages (chat_id, role, content, status, error_code, created_at) VALUES (?, 'user', ?, 'completed', NULL, ?)",
      );
      for (let index = 0; index < 1005; index += 1) {
        statement.run(chat.id, `history-${index}`, new Date().toISOString());
      }
    });
    insertHistory();

    const historyResponse = await request(`/api/chats/${chat.id}`);
    assert.equal(historyResponse.status, 200);
    const historyBody = await historyResponse.json();
    assert.equal(historyBody.messages.length, 1000);
    assert.equal(historyBody.messages[0].content, "history-5");
    assert.equal(historyBody.messages.at(-1).content, "history-1004");
  } else {
    for (let index = 1; index < 10; index += 1) {
      const message = await request(`/api/chats/${chat.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: `quota-${index}` }),
      });
      assert.equal(message.status, 200);
    }
  }

  const messageOverLimit = await request(`/api/chats/${chat.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "This message must be rejected" }),
  });
  assert.equal(messageOverLimit.status, 409);
  assert.equal((await messageOverLimit.json()).error.code, "MESSAGE_LIMIT_REACHED");

  const secondChat = await request("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Second chat" }),
  });
  assert.equal(secondChat.status, 201);
  const chatOverLimit = await request("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Third chat" }),
  });
  assert.equal(chatOverLimit.status, 409);
  assert.equal((await chatOverLimit.json()).error.code, "CHAT_LIMIT_REACHED");

  const deleteProviders = await request("/api/providers", { method: "DELETE" });
  assert.equal(deleteProviders.status, 200);
  assert.equal((await deleteProviders.json()).deletedCount, 1);

  process.stdout.write(
    "Smoke test passed: production auth, CORS, quotas, recent history, credentials, and receipts.\n",
  );
} finally {
  parentDatabase?.close();
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
