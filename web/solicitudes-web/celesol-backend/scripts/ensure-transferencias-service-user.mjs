// Operational provisioning only; never run automatically on startup or deployment.
// Execute from the backend directory (with dist/ built), or pass via stdin to
// node --input-type=module in the deployed container. Without --create, only read.
/* global process, console */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

class ServiceIdentityError extends Error {}

const identity = {
  email: "svc-transferencias@redunisol.invalid",
  legacyUser: "svc-transferencias-beex",
};
const select = {
  id: true,
  email: true,
  legacyUser: true,
  state: true,
  isSystemAdmin: true,
  emailVerified: true,
  recibeAsignacionAutomatica: true,
  deletedAt: true,
  workflowOwner: { select: { code: true, isActive: true } },
};

function verify(user) {
  if (
    user.email !== identity.email ||
    user.legacyUser !== identity.legacyUser ||
    user.state !== 1 ||
    user.isSystemAdmin ||
    user.emailVerified ||
    user.recibeAsignacionAutomatica ||
    user.deletedAt ||
    user.workflowOwner?.code !== "TESORERIA" ||
    !user.workflowOwner.isActive
  ) {
    throw new ServiceIdentityError("Service identity conflicts with required permissions; no existing user was modified.");
  }
  return user;
}

async function run() {
  if (process.argv.slice(2).some((arg) => arg !== "--create")) {
    throw new ServiceIdentityError("Only --create is supported; omit it for read-only inspection.");
  }
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const owner = await tx.workflowOwner.findUnique({ where: { code: "TESORERIA" } });
      if (!owner?.isActive) throw new ServiceIdentityError("TESORERIA must exist and be active.");
      const existing = await tx.user.findMany({
        where: { OR: [{ email: identity.email }, { legacyUser: identity.legacyUser }] },
        select,
      });
      if (existing.length > 1) throw new ServiceIdentityError("Service identity is ambiguous; no users were modified.");
      if (existing.length === 1) return { created: false, user: verify(existing[0]) };
      if (!process.argv.includes("--create")) return { created: false, user: null };

      const { AuthPrismaDatasource } = await import(pathToFileURL(resolve(
        "dist/modules/auth/infrastructure/datasources/AuthPrismaDatasource.js",
      )).href);
      const { BcryptPasswordHasher } = await import(pathToFileURL(resolve(
        "dist/modules/auth/infrastructure/services/BcryptPasswordHasher.js",
      )).href);
      // Discard the random password. This identity authenticates via the separate
      // integration token, never by a human login or an email verification flow.
      const passwordHash = await new BcryptPasswordHasher().hash(randomBytes(48).toString("base64url"));
      const created = await new AuthPrismaDatasource(tx).create({
        ...identity,
        firstName: "Servicio",
        lastName: "Transferencias Beex",
        passwordHash,
        state: 1,
        workflowOwnerId: owner.id,
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: created.id }, select });
      // Roll back if schema defaults or application behavior violate the policy.
      return { created: true, user: verify(user) };
    });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  // Do not print database connection details, hashes, or input data from errors.
  console.error(error instanceof ServiceIdentityError
    ? error.message
    : `Provisioning failed (${error.code ?? error.name}).`);
  process.exitCode = 1;
});
