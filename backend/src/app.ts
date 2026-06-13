import crypto from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { allowedOrigins } from "@/config.js";
import db from "@/db.js";
import { authRoutes } from "@/routes/auth.js";
import { chatRoutes } from "@/routes/chats.js";
import { providerRoutes } from "@/routes/providers.js";
import { reconcileCredentialEncryption } from "@/services/provider-config.js";
import { logError, logWarn } from "@/utils/logger.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedOriginSet = new Set(allowedOrigins);

type RootEnv = {
  Variables: {
    requestId: string;
  };
};

const credentialReconciliation = await reconcileCredentialEncryption();
if (credentialReconciliation.deletedCredentials > 0) {
  logWarn("unreadable_credentials_removed", {
    deletedCredentials: credentialReconciliation.deletedCredentials,
    affectedUsers: credentialReconciliation.affectedUsers,
  });
}

export function createApp(): Hono<RootEnv> {
  const app = new Hono<RootEnv>();

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });
  app.use("*", secureHeaders());
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOriginSet.has(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 86400,
    }),
  );
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (unsafeMethods.has(c.req.method) && (!origin || !allowedOriginSet.has(origin))) {
      return c.json({ error: { message: "Origin is not allowed", code: "FORBIDDEN_ORIGIN" } }, 403);
    }
    await next();
  });

  app.get("/api/health", async (c) => {
    try {
      await db.selectFrom("app_metadata").select("key").limit(1).execute();
      return c.json({ status: "ok", timestamp: new Date().toISOString() });
    } catch {
      return c.json({ status: "unavailable", timestamp: new Date().toISOString() }, 503);
    }
  });
  app.route("/api/auth", authRoutes);
  app.route("/api/chats", chatRoutes);
  app.route("/api/providers", providerRoutes);

  app.notFound((c) => c.json({ error: { message: "Route not found", code: "NOT_FOUND" } }, 404));
  app.onError((error, c) => {
    const requestId = c.get("requestId") || "unknown";
    logError("unhandled_request_error", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return c.json({ error: { message: "Internal server error", code: "INTERNAL_ERROR" } }, 500);
  });

  return app;
}

const app = createApp();

export default app;
