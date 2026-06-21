import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { config } from "@/config.js";
import db from "@/db.js";

export const SESSION_COOKIE = config.COOKIE_SECURE ? "__Host-chatbot_session" : "chatbot_session";
export const CSRF_COOKIE = config.COOKIE_SECURE ? "__Host-chatbot_csrf" : "chatbot_csrf";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface SessionPayload {
  userId: number;
  username: string;
  iat: number;
  exp: number;
  nbf: number;
  sessionVersion: number;
  csrfToken: string;
  lastActivity: number;
}

export type AppEnv = {
  Variables: {
    session: SessionPayload;
  };
};

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createSessionToken(
  userId: number | bigint,
  username: string,
  sessionVersion: number,
  csrfToken: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      userId: Number(userId),
      username,
      sessionVersion,
      csrfToken,
      lastActivity: now,
      iat: now,
      nbf: now - 30,
      exp: now + config.SESSION_TTL_HOURS * 3600,
    },
    config.JWT_SECRET,
    "HS256",
  );
}

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: "/",
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });
}

export function setCsrfCookie(c: Parameters<typeof setCookie>[0], csrfToken: string): void {
  setCookie(c, CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: "/",
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });
}

export function clearSessionCookies(c: Parameters<typeof deleteCookie>[0]): void {
  const options = { path: "/", secure: config.COOKIE_SECURE, sameSite: config.COOKIE_SAME_SITE } as const;
  deleteCookie(c, SESSION_COOKIE, { ...options, httpOnly: true });
  deleteCookie(c, CSRF_COOKIE, options);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

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
    const lastActivity = Number(payload.lastActivity);
    const csrfToken = String(payload.csrfToken || "");
    const now = Math.floor(Date.now() / 1000);

    if (
      !Number.isInteger(userId) ||
      !Number.isInteger(iat) ||
      !Number.isInteger(exp) ||
      !Number.isInteger(sessionVersion) ||
      !Number.isInteger(lastActivity) ||
      !csrfToken ||
      exp <= now
    ) {
      throw new Error("Invalid session claims");
    }

    const idleTimeoutSeconds = config.SESSION_IDLE_TIMEOUT_HOURS * 3600;
    if (idleTimeoutSeconds > 0 && now - lastActivity > idleTimeoutSeconds) {
      clearSessionCookies(c);
      return c.json({ error: { message: "Session expired due to inactivity", code: "UNAUTHORIZED" } }, 401);
    }

    if (unsafeMethods.has(c.req.method)) {
      const csrfHeader = c.req.header("x-csrf-token") || "";
      if (!csrfHeader || !constantTimeEqual(csrfHeader, csrfToken)) {
        return c.json({ error: { message: "CSRF token missing or invalid", code: "CSRF_VALIDATION_FAILED" } }, 403);
      }
    }

    const user = await db
      .selectFrom("users")
      .select(["username", "session_version"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (!user || user.session_version !== sessionVersion) throw new Error("Session revoked");

    const session: SessionPayload = {
      userId,
      username: user.username,
      iat,
      exp,
      nbf: Number(payload.nbf) || iat,
      sessionVersion,
      csrfToken,
      lastActivity,
    };
    c.set("session", session);
    await next();

    const afterNow = Math.floor(Date.now() / 1000);
    if (afterNow - lastActivity >= config.SESSION_REFRESH_INTERVAL_SECONDS) {
      const refreshedToken = await createSessionToken(userId, user.username, sessionVersion, csrfToken);
      setSessionCookie(c, refreshedToken);
      setCsrfCookie(c, csrfToken);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Session revoked") {
      clearSessionCookies(c);
    }
    return c.json({ error: { message: "Session expired or invalid", code: "UNAUTHORIZED" } }, 401);
  }
};
