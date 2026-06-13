import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { config } from "@/config.js";
import db from "@/db.js";

export const SESSION_COOKIE = config.COOKIE_SECURE ? "__Host-chatbot_session" : "chatbot_session";

export interface SessionPayload {
  userId: number;
  username: string;
  iat: number;
  exp: number;
  sessionVersion: number;
}

export type AppEnv = {
  Variables: {
    session: SessionPayload;
  };
};

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: { message: "Authentication required", code: "UNAUTHORIZED" } }, 401);
  }

  try {
    const payload = await verify(token, config.JWT_SECRET, "HS256");
    const userId = Number(payload.userId);
    const iat = Number(payload.iat);
    const exp = Number(payload.exp);
    const sessionVersion = Number(payload.sessionVersion);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(userId) ||
      !Number.isInteger(iat) ||
      !Number.isInteger(exp) ||
      !Number.isInteger(sessionVersion) ||
      exp <= now
    ) {
      throw new Error("Invalid session claims");
    }
    const user = await db
      .selectFrom("users")
      .select(["username", "session_version"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (!user || user.session_version !== sessionVersion) throw new Error("Session revoked");
    c.set("session", { userId, username: user.username, iat, exp, sessionVersion });
    await next();
  } catch {
    return c.json({ error: { message: "Session expired or invalid", code: "UNAUTHORIZED" } }, 401);
  }
};
