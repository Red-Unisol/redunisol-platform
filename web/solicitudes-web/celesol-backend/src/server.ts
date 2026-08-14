import "dotenv/config";

import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/prisma";

const server = app.listen(env.PORT, () => {
  console.log(`Celesol backend listening on port ${env.PORT}`);
  void logStartupHealthChecks();
});

async function logStartupHealthChecks() {
  console.log("Startup health checks:");
  console.log("  GET /health    OK");

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("  GET /health/db OK");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`  GET /health/db FAIL - ${message}`);
  }
}

async function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down Celesol backend.`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
