/* global process, console, URL */
// Manual dev-only provisioning. Never run during startup or deployment.
// Omit --create for read-only inspection. Creation requires explicit operator approval.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

class QaIdentityError extends Error {}
const identity = { email: "qa-beex-dev@redunisol.invalid", legacyUser: "qa-beex-dev" };
const select = {
  id: true, email: true, legacyUser: true, isSystemAdmin: true,
  emailVerified: true, state: true, deletedAt: true, recibeAsignacionAutomatica: true,
  workflowOwner: { select: { code: true, isActive: true } },
};

function verify(user) {
  if (user.email !== identity.email || user.legacyUser !== identity.legacyUser ||
      !user.isSystemAdmin || !user.emailVerified || user.state !== 1 ||
      user.deletedAt || user.recibeAsignacionAutomatica ||
      user.workflowOwner?.code !== "VENDEDORES" || !user.workflowOwner.isActive) {
    throw new QaIdentityError("QA identity differs from the desired state; no user was modified.");
  }
  return user;
}

async function run() {
  if (process.argv.slice(2).some(arg => arg !== "--create")) {
    throw new QaIdentityError("Only --create is supported; omit it for read-only inspection.");
  }
  if (process.env.APP_ORIGIN !== "https://solicitudes-dev.redunisol.com.ar" ||
      new URL(process.env.DATABASE_URL).pathname !== "/solicitudes_web_dev") {
    throw new QaIdentityError("This operation is restricted to the Beex dev origin and database.");
  }
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async tx => {
      const owner = await tx.workflowOwner.findUnique({ where: { code: "VENDEDORES" } });
      if (!owner?.isActive) throw new QaIdentityError("VENDEDORES must exist and be active.");
      const existing = await tx.user.findMany({
        where: { OR: [{ email: identity.email }, { legacyUser: identity.legacyUser }] }, select,
      });
      if (existing.length > 1) throw new QaIdentityError("Ambiguous QA identity; no users were modified.");
      if (existing.length === 1) return { created: false, user: verify(existing[0]) };
      if (!process.argv.includes("--create")) return { created: false, user: null };
      const password = process.env.BEEX_QA_ADMIN_PASSWORD;
      if (!password || password.length < 24 || password.length > 128 || /\s/.test(password)) {
        throw new QaIdentityError("Provide a private generated BEEX_QA_ADMIN_PASSWORD of 24-128 non-whitespace characters.");
      }
      const { AuthPrismaDatasource } = await import(pathToFileURL(resolve(
        "dist/modules/auth/infrastructure/datasources/AuthPrismaDatasource.js",
      )).href);
      const { BcryptPasswordHasher } = await import(pathToFileURL(resolve(
        "dist/modules/auth/infrastructure/services/BcryptPasswordHasher.js",
      )).href);
      const datasource = new AuthPrismaDatasource(tx);
      const created = await datasource.create({
        ...identity, firstName: "QA", lastName: "Beex Dev", state: 1,
        passwordHash: await new BcryptPasswordHasher().hash(password), workflowOwnerId: owner.id,
      });
      await datasource.updateUser({ id: created.id, isSystemAdmin: true,
        emailVerified: true, recibeAsignacionAutomatica: false });
      return { created: true, user: verify(await tx.user.findUniqueOrThrow({ where: { id: created.id }, select })) };
    });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}
run().catch(error => {
  console.error(error instanceof QaIdentityError ? error.message : `Provisioning failed (${error.code ?? error.name}).`);
  process.exitCode = 1;
});