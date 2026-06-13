import { getConnInfo } from "@hono/node-server/conninfo";
import type { MiddlewareHandler } from "hono";
import ipaddr from "ipaddr.js";
import { config } from "@/config.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_ENTRIES = 10_000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);
cleanupTimer.unref();

function clientIdentifier(c: Parameters<MiddlewareHandler>[0]): string {
  if (config.TRUST_PROXY) {
    const forwarded = c.req
      .header("x-forwarded-for")
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => ipaddr.isValid(value));
    const trustedClientIndex = forwarded ? forwarded.length - config.TRUST_PROXY_HOPS : -1;
    if (forwarded && trustedClientIndex >= 0) return forwarded[trustedClientIndex];
    const realIp = c.req.header("x-real-ip")?.trim();
    if (realIp && ipaddr.isValid(realIp)) return realIp;
  }
  return getConnInfo(c).remote.address || "unknown";
}

export function rateLimit(maxRequests = 30, windowMs = 60_000): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    const key = `${clientIdentifier(c)}:${c.req.method}:${c.req.routePath || c.req.path}`;
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      if (store.size >= MAX_STORE_ENTRIES) {
        const oldest = store.keys().next().value as string | undefined;
        if (oldest) store.delete(oldest);
      }
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json(
        { error: { message: "Too many requests. Please try again later.", code: "RATE_LIMIT_EXCEEDED" } },
        429,
      );
    }
    await next();
  };
}
