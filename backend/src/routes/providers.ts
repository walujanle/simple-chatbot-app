import { Hono } from "hono";
import { z } from "zod";
import db from "@/db.js";
import { type AppEnv, authMiddleware } from "@/middleware/auth.js";
import { rateLimit } from "@/middleware/rate-limit.js";
import { createProviderAdapter } from "@/providers/index.js";
import {
  acknowledgeCredentialReset,
  activateProviderConfig,
  deleteAllProviderConfigs,
  deleteProviderConfig,
  getProviderCredential,
  listProviderConfigs,
  saveProviderConfig,
} from "@/services/provider-config.js";
import { validateExternalUrl } from "@/utils/network.js";

const providers = new Hono<AppEnv>();
providers.use("*", authMiddleware);
providers.use("*", rateLimit(120, 60_000));

const providerSchema = z.enum(["openai-compatible", "anthropic", "gemini"]);
const configSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    provider: providerSchema,
    apiKey: z.string().trim().min(8).max(512).optional(),
    reuseApiKeyFromConfigId: z.string().uuid().optional().nullable(),
    baseUrl: z.string().trim().url().max(2048).nullable(),
    apiVersion: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._-]{1,32}$/)
      .nullable()
      .optional()
      .default(null),
    model: z.string().trim().min(1).max(200),
    contextWindow: z.number().int().min(4096).max(2_000_000),
    maxOutputTokens: z.number().int().min(64).max(131_072),
    temperature: z.number().min(0).max(2),
    reasoningEffort: z.enum(["off", "low", "medium", "high"]),
    isActive: z.boolean(),
  })
  .refine((value) => value.maxOutputTokens <= value.contextWindow - 2048, {
    message: "Maximum output tokens must leave at least 2048 tokens for input context",
  });

providers.get("/", async (c) => {
  const userId = c.get("session").userId;
  const user = await db
    .selectFrom("users")
    .select("credential_reset_required")
    .where("id", "=", userId)
    .executeTakeFirst();
  return c.json({
    providers: await listProviderConfigs(userId),
    credentialResetRequired: user?.credential_reset_required === 1,
  });
});

providers.delete("/", async (c) => {
  const deletedCount = await deleteAllProviderConfigs(c.get("session").userId);
  return c.json({ success: true, deletedCount });
});

providers.post("/credential-reset/acknowledge", async (c) => {
  await acknowledgeCredentialReset(c.get("session").userId);
  return c.json({ success: true });
});

providers.post("/", rateLimit(20, 60_000), async (c) => {
  const configResult = configSchema.safeParse(await c.req.json().catch(() => null));
  if (!configResult.success) {
    return c.json(
      {
        error: {
          message: configResult.error.issues[0]?.message || "Invalid configuration",
          code: "VALIDATION_ERROR",
        },
      },
      400,
    );
  }

  const { data } = configResult;
  if (data.provider === "openai-compatible" && !data.baseUrl) {
    return c.json({ error: { message: "Base URL is required", code: "VALIDATION_ERROR" } }, 400);
  }

  if (data.baseUrl) {
    try {
      await validateExternalUrl(data.baseUrl);
    } catch (error) {
      return c.json(
        { error: { message: error instanceof Error ? error.message : "Invalid endpoint", code: "INVALID_ENDPOINT" } },
        400,
      );
    }
  }

  if (data.provider !== "gemini" && data.apiVersion) {
    return c.json({ error: { message: "API version is only configurable for Gemini", code: "VALIDATION_ERROR" } }, 400);
  }

  try {
    const saved = await saveProviderConfig(c.get("session").userId, {
      name: data.name,
      provider: data.provider,
      apiKey: data.apiKey,
      reuseApiKeyFromConfigId: data.reuseApiKeyFromConfigId || undefined,
      baseUrl: data.baseUrl,
      apiVersion: data.provider === "gemini" ? data.apiVersion : null,
      model: data.model,
      contextWindow: data.contextWindow,
      maxOutputTokens: data.maxOutputTokens,
      temperature: data.temperature,
      reasoningEffort: data.reasoningEffort,
      isActive: data.isActive,
    });
    return c.json({ provider: saved });
  } catch (error) {
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Unable to save configuration",
          code: "SAVE_PROVIDER_FAILED",
        },
      },
      400,
    );
  }
});

providers.put("/:id", rateLimit(20, 60_000), async (c) => {
  const id = c.req.param("id");
  const configResult = configSchema.safeParse(await c.req.json().catch(() => null));
  if (!configResult.success) {
    return c.json(
      {
        error: {
          message: configResult.error.issues[0]?.message || "Invalid configuration",
          code: "VALIDATION_ERROR",
        },
      },
      400,
    );
  }

  const { data } = configResult;
  if (data.provider === "openai-compatible" && !data.baseUrl) {
    return c.json({ error: { message: "Base URL is required", code: "VALIDATION_ERROR" } }, 400);
  }

  if (data.baseUrl) {
    try {
      await validateExternalUrl(data.baseUrl);
    } catch (error) {
      return c.json(
        { error: { message: error instanceof Error ? error.message : "Invalid endpoint", code: "INVALID_ENDPOINT" } },
        400,
      );
    }
  }

  if (data.provider !== "gemini" && data.apiVersion) {
    return c.json({ error: { message: "API version is only configurable for Gemini", code: "VALIDATION_ERROR" } }, 400);
  }

  try {
    const saved = await saveProviderConfig(c.get("session").userId, {
      id,
      name: data.name,
      provider: data.provider,
      apiKey: data.apiKey,
      reuseApiKeyFromConfigId: data.reuseApiKeyFromConfigId || undefined,
      baseUrl: data.baseUrl,
      apiVersion: data.provider === "gemini" ? data.apiVersion : null,
      model: data.model,
      contextWindow: data.contextWindow,
      maxOutputTokens: data.maxOutputTokens,
      temperature: data.temperature,
      reasoningEffort: data.reasoningEffort,
      isActive: data.isActive,
    });
    return c.json({ provider: saved });
  } catch (error) {
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Unable to save configuration",
          code: "SAVE_PROVIDER_FAILED",
        },
      },
      400,
    );
  }
});

providers.post("/:id/test", rateLimit(10, 60_000), async (c) => {
  const id = c.req.param("id");
  const credential = await getProviderCredential(c.get("session").userId, id);
  if (!credential) {
    return c.json({ error: { message: "Configuration not found", code: "PROVIDER_NOT_CONFIGURED" } }, 400);
  }
  try {
    await createProviderAdapter(credential).validate(AbortSignal.timeout(20_000));
    return c.json({ success: true });
  } catch {
    return c.json(
      {
        error: {
          message: "Provider connection failed. Check the key, endpoint, and model.",
          code: "PROVIDER_TEST_FAILED",
        },
      },
      502,
    );
  }
});

providers.post("/:id/activate", async (c) => {
  const id = c.req.param("id");
  try {
    const provider = await activateProviderConfig(c.get("session").userId, id);
    return c.json({ success: true, provider });
  } catch (error) {
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Unable to activate configuration",
          code: "ACTIVATE_PROVIDER_FAILED",
        },
      },
      400,
    );
  }
});

providers.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await deleteProviderConfig(c.get("session").userId, id);
  return c.json({ success: true });
});

export { providers as providerRoutes };
