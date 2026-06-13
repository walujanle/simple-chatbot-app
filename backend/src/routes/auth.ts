import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import { z } from "zod";
import { config } from "@/config.js";
import { insertUser } from "@/database/write.js";
import db, { nowIso } from "@/db.js";
import { type AppEnv, authMiddleware, SESSION_COOKIE } from "@/middleware/auth.js";
import { rateLimit } from "@/middleware/rate-limit.js";
import { exceedsBcryptInputLimit, hashPassword, verifyPassword } from "@/utils/password.js";

const auth = new Hono<AppEnv>();

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores");

const newPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128)
  .refine((password) => !exceedsBcryptInputLimit(password), "Password must not exceed 72 UTF-8 bytes");

const registerSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
});

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1).max(128) });

const updateProfileSchema = z.object({
  username: usernameSchema,
  system_prompt: z.string().trim().max(12000).nullable(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: newPasswordSchema,
});

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: "/",
    maxAge: config.SESSION_TTL_HOURS * 60 * 60,
  });
}

auth.get("/config", (c) => c.json({ registrationEnabled: config.REGISTRATION_ENABLED }));

async function createSessionToken(userId: number | bigint, username: string, sessionVersion: number): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return sign(
    { userId: Number(userId), username, sessionVersion, iat, exp: iat + config.SESSION_TTL_HOURS * 60 * 60 },
    config.JWT_SECRET,
    "HS256",
  );
}

auth.post("/register", rateLimit(5, 60_000), async (c) => {
  if (!config.REGISTRATION_ENABLED) {
    return c.json({ error: { message: "Registration is disabled", code: "REGISTRATION_DISABLED" } }, 403);
  }
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { message: parsed.error.issues[0]?.message || "Invalid input", code: "VALIDATION_ERROR" } },
      400,
    );
  }

  const normalizedUsername = parsed.data.username.toLowerCase();
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("username_normalized", "=", normalizedUsername)
    .executeTakeFirst();
  if (existing) {
    return c.json({ error: { message: "Username already taken", code: "USERNAME_TAKEN" } }, 409);
  }

  const password = await hashPassword(parsed.data.password);
  try {
    const userId = await insertUser(db, {
      username: parsed.data.username,
      username_normalized: normalizedUsername,
      password,
      system_prompt: null,
      temperature: 0.7,
      max_tokens: 2048,
      session_version: 0,
      credential_reset_required: 0,
      active_provider: null,
      created_at: nowIso(),
    });
    setSessionCookie(c, await createSessionToken(userId, parsed.data.username, 0));
    return c.json(
      {
        user: {
          id: userId,
          username: parsed.data.username,
          credentialResetRequired: false,
        },
      },
      201,
    );
  } catch {
    return c.json({ error: { message: "Unable to create account", code: "CREATE_ACCOUNT_FAILED" } }, 500);
  }
});

auth.post("/login", rateLimit(10, 60_000), async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { message: "Username and password are required", code: "VALIDATION_ERROR" } }, 400);
  }

  const user = await db
    .selectFrom("users")
    .select(["id", "username", "password", "session_version", "credential_reset_required"])
    .where("username_normalized", "=", parsed.data.username.toLowerCase())
    .executeTakeFirst();
  const passwordResult = user ? await verifyPassword(user.password, parsed.data.password) : null;
  if (!user || !passwordResult?.valid) {
    return c.json({ error: { message: "Invalid username or password", code: "INVALID_CREDENTIALS" } }, 401);
  }

  if (passwordResult.needsRehash) {
    await db
      .updateTable("users")
      .set({ password: await hashPassword(parsed.data.password) })
      .where("id", "=", user.id)
      .execute();
  }

  setSessionCookie(c, await createSessionToken(user.id, user.username, user.session_version));
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      credentialResetRequired: user.credential_reset_required === 1,
    },
  });
});

auth.post("/logout", authMiddleware, async (c) => {
  await db
    .updateTable("users")
    .set((expression) => ({ session_version: expression("session_version", "+", 1) }))
    .where("id", "=", c.get("session").userId)
    .execute();
  deleteCookie(c, SESSION_COOKIE, {
    path: "/",
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
  });
  return c.json({ success: true });
});

auth.get("/profile", authMiddleware, async (c) => {
  const session = c.get("session");
  const user = await db
    .selectFrom("users")
    .select(["id", "username", "system_prompt", "credential_reset_required"])
    .where("id", "=", session.userId)
    .executeTakeFirst();
  if (!user) {
    return c.json({ error: { message: "User not found", code: "USER_NOT_FOUND" } }, 404);
  }
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      system_prompt: user.system_prompt,
      credentialResetRequired: user.credential_reset_required === 1,
    },
  });
});

auth.put("/profile", authMiddleware, async (c) => {
  const session = c.get("session");
  const parsed = updateProfileSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { message: parsed.error.issues[0]?.message || "Invalid input", code: "VALIDATION_ERROR" } },
      400,
    );
  }

  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("username_normalized", "=", parsed.data.username.toLowerCase())
    .where("id", "!=", session.userId)
    .executeTakeFirst();
  if (existing) {
    return c.json({ error: { message: "Username already taken", code: "USERNAME_TAKEN" } }, 409);
  }

  await db
    .updateTable("users")
    .set({
      username: parsed.data.username,
      username_normalized: parsed.data.username.toLowerCase(),
      system_prompt: parsed.data.system_prompt,
    })
    .where("id", "=", session.userId)
    .execute();
  setSessionCookie(c, await createSessionToken(session.userId, parsed.data.username, session.sessionVersion));
  const state = await db
    .selectFrom("users")
    .select("credential_reset_required")
    .where("id", "=", session.userId)
    .executeTakeFirstOrThrow();
  return c.json({
    user: {
      id: session.userId,
      username: parsed.data.username,
      system_prompt: parsed.data.system_prompt,
      credentialResetRequired: state.credential_reset_required === 1,
    },
  });
});

auth.put("/password", authMiddleware, rateLimit(5, 60_000), async (c) => {
  const session = c.get("session");
  const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { message: parsed.error.issues[0]?.message || "Invalid input", code: "VALIDATION_ERROR" } },
      400,
    );
  }

  const user = await db.selectFrom("users").select("password").where("id", "=", session.userId).executeTakeFirst();
  const passwordResult = user ? await verifyPassword(user.password, parsed.data.currentPassword) : null;
  if (!user || !passwordResult?.valid) {
    return c.json({ error: { message: "Incorrect current password", code: "INCORRECT_PASSWORD" } }, 400);
  }

  const newVersion = session.sessionVersion + 1;
  await db
    .updateTable("users")
    .set({ password: await hashPassword(parsed.data.newPassword), session_version: newVersion })
    .where("id", "=", session.userId)
    .execute();
  const currentUser = await db
    .selectFrom("users")
    .select("username")
    .where("id", "=", session.userId)
    .executeTakeFirstOrThrow();
  setSessionCookie(c, await createSessionToken(session.userId, currentUser.username, newVersion));
  return c.json({ success: true });
});

export { auth as authRoutes };
