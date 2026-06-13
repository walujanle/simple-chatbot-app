import { Hono } from "hono";
import { z } from "zod";
import db from "@/db.js";
import { type AppEnv, authMiddleware } from "@/middleware/auth.js";
import { rateLimit } from "@/middleware/rate-limit.js";
import { type AIProvider, createProviderAdapter } from "@/providers/index.js";
import {
  acknowledgeCredentialReset,
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
    apiKey: z.string().trim().min(8).max(512).optional(),
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

providers.put("/:provider", rateLimit(20, 60_000), async (c) => {
  const providerResult = providerSchema.safeParse(c.req.param("provider"));
  const configResult = configSchema.safeParse(await c.req.json().catch(() => null));
  if (!providerResult.success || !configResult.success) {
    return c.json(
      {
        error: {
          message: configResult.error?.issues[0]?.message || "Invalid provider configuration",
          code: "VALIDATION_ERROR",
        },
      },
      400,
    );
  }

  if (providerResult.data === "openai-compatible" && !configResult.data.baseUrl) {
    return c.json({ error: { message: "Base URL is required", code: "VALIDATION_ERROR" } }, 400);
  }

  if (configResult.data.baseUrl) {
    try {
      await validateExternalUrl(configResult.data.baseUrl);
    } catch (error) {
      return c.json(
        { error: { message: error instanceof Error ? error.message : "Invalid endpoint", code: "INVALID_ENDPOINT" } },
        400,
      );
    }
  }

  if (providerResult.data !== "gemini" && configResult.data.apiVersion) {
    return c.json({ error: { message: "API version is only configurable for Gemini", code: "VALIDATION_ERROR" } }, 400);
  }

  try {
    const saved = await saveProviderConfig(c.get("session").userId, {
      provider: providerResult.data,
      apiKey: configResult.data.apiKey,
      baseUrl: configResult.data.baseUrl,
      apiVersion: providerResult.data === "gemini" ? configResult.data.apiVersion : null,
      model: configResult.data.model,
      contextWindow: configResult.data.contextWindow,
      maxOutputTokens: configResult.data.maxOutputTokens,
      temperature: configResult.data.temperature,
      reasoningEffort: configResult.data.reasoningEffort,
      isActive: configResult.data.isActive,
    });
    return c.json({ provider: saved });
  } catch (error) {
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Unable to save provider",
          code: "SAVE_PROVIDER_FAILED",
        },
      },
      400,
    );
  }
});

providers.post("/:provider/test", rateLimit(10, 60_000), async (c) => {
  const provider = providerSchema.safeParse(c.req.param("provider"));
  if (!provider.success) {
    return c.json({ error: { message: "Unknown provider", code: "VALIDATION_ERROR" } }, 400);
  }
  const credential = await getProviderCredential(c.get("session").userId, provider.data);
  if (!credential) {
    return c.json({ error: { message: "Save the provider first", code: "PROVIDER_NOT_CONFIGURED" } }, 400);
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

providers.delete("/:provider", async (c) => {
  const provider = providerSchema.safeParse(c.req.param("provider"));
  if (!provider.success) {
    return c.json({ error: { message: "Unknown provider", code: "VALIDATION_ERROR" } }, 400);
  }
  await deleteProviderConfig(c.get("session").userId, provider.data as AIProvider);
  return c.json({ success: true });
});

export { providers as providerRoutes };
