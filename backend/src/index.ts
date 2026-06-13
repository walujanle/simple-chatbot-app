import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import app from "@/app.js";
import { config } from "@/config.js";
import { closeDatabase } from "@/db.js";
import { abortActiveChatStreams } from "@/routes/chats.js";
import { logInfo } from "@/utils/logger.js";
import { closeNetworkDispatchers } from "@/utils/network.js";

const server = serve({ fetch: app.fetch, port: config.PORT }) as Server;
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;
logInfo("server_started", { port: config.PORT });

let shuttingDown = false;
let resourcesClosed = false;

async function closeResourcesOnce(): Promise<void> {
  if (resourcesClosed) return;
  resourcesClosed = true;
  await Promise.allSettled([closeNetworkDispatchers(), closeDatabase()]);
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("server_shutdown_started", { signal });
  abortActiveChatStreams();
  server.close(async () => {
    await closeResourcesOnce();
    process.exit(0);
  });
  setTimeout(async () => {
    server.closeAllConnections();
    await closeResourcesOnce();
    process.exit(1);
  }, 10_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
