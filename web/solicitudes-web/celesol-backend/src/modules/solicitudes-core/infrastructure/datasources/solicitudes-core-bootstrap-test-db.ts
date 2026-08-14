import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function getBootstrapTestDatabaseUrl() {
  return TEST_DATABASE_URL ?? null;
}

export function ensureSafeBootstrapTestDatabaseUrl() {
  assert.ok(
    TEST_DATABASE_URL,
    "TEST_DATABASE_URL is required for bootstrap integration tests.",
  );

  const parsedUrl = new URL(TEST_DATABASE_URL);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");

  assert.match(
    databaseName,
    /(^|[_-])test([_-]|$)/i,
    `Refusing to run bootstrap integration tests against non-test database "${databaseName}".`,
  );

  return TEST_DATABASE_URL;
}

export function resetBootstrapTestDatabase() {
  const databaseUrl = ensureSafeBootstrapTestDatabaseUrl();
  const prismaCommand = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : prismaCommand;
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `"${prismaCommand}" migrate reset --force --skip-generate --skip-seed`]
      : ["migrate", "reset", "--force", "--skip-generate", "--skip-seed"];

  try {
    if (process.platform === "win32") {
      execSync(
        `"${prismaCommand}" migrate reset --force --skip-generate --skip-seed`,
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
          },
          stdio: "pipe",
        },
      );
      return;
    }

    execFileSync(
      command,
      args,
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: "pipe",
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("_prisma_migrations")) {
      throw error;
    }

    if (process.platform === "win32") {
      execSync(`"${prismaCommand}" migrate deploy`, {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: "pipe",
      });
      return;
    }

    execFileSync(prismaCommand, ["migrate", "deploy"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: "pipe",
    });
  }
}

export function createBootstrapTestPrismaClient() {
  const databaseUrl = ensureSafeBootstrapTestDatabaseUrl();

  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}
