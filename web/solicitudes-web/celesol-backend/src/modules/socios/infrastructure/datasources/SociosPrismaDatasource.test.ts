import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";

import { prisma } from "../../../../db/prisma";
import {
  SocioCuitDuplicateError,
  SocioDocumentoDuplicateError,
} from "../../domain/socios-errors";
import { SociosPrismaDatasource } from "./SociosPrismaDatasource";

describe("SociosPrismaDatasource", () => {
  it("creates a persona fisica socio", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    const socio = await datasource.create({
      apellido: "Perez",
      celular: null,
      cuit: "20123456783",
      domicilioCalle: "San Martin",
      domicilioCodigoPostal: "2300",
      domicilioLocalidad: "12",
      domicilioNroPuerta: "742",
      email: "user@example.com",
      fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
      nombre: "Juan",
      nroDocumento: "12345678",
      nroSocioLegacy: null,
      razonSocial: null,
      sexo: "M",
      tipoDocumento: "DNI",
      tipoPersona: "FISICA",
    });

    assert.deepEqual(prisma.socioCreateCalls[0], {
      data: {
        apellido: "Perez",
        celular: null,
        cuit: "20123456783",
        domicilioCalle: "San Martin",
        domicilioCodigoPostal: "2300",
        domicilioLocalidad: "12",
        domicilioNroPuerta: "742",
        email: "user@example.com",
        fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
        nombre: "Juan",
        nroDocumento: "12345678",
        nroSocioLegacy: null,
        razonSocial: null,
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      },
    });
    assert.equal(socio.tipoPersona, "FISICA");
    assert.equal(socio.nroDocumento, "12345678");
  });

  it("persists domicilio fields for persona fisica", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.create({
      apellido: "Perez",
      celular: null,
      cuit: "20123456783",
      domicilioCalle: "San Martin",
      domicilioCodigoPostal: "2300",
      domicilioLocalidad: "12",
      domicilioNroPuerta: "742",
      email: null,
      fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
      nombre: "Juan",
      nroDocumento: "12345678",
      nroSocioLegacy: "999",
      razonSocial: null,
      sexo: "M",
      tipoDocumento: "DNI",
      tipoPersona: "FISICA",
    });

    assert.equal(prisma.socioCreateCalls[0]?.data.domicilioCalle, "San Martin");
    assert.equal(prisma.socioCreateCalls[0]?.data.domicilioNroPuerta, "742");
    assert.equal(prisma.socioCreateCalls[0]?.data.domicilioLocalidad, "12");
    assert.equal(
      prisma.socioCreateCalls[0]?.data.domicilioCodigoPostal,
      "2300",
    );
  });

  it("persists domicilio fields for persona juridica", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.create({
      apellido: null,
      celular: null,
      cuit: "30123456789",
      domicilioCalle: "Belgrano",
      domicilioCodigoPostal: "2300",
      domicilioLocalidad: "12",
      domicilioNroPuerta: "1500",
      email: null,
      fechaDeNacimiento: null,
      nombre: null,
      nroDocumento: null,
      nroSocioLegacy: null,
      razonSocial: "ACME SA",
      sexo: null,
      tipoDocumento: null,
      tipoPersona: "JURIDICA",
    });

    assert.equal(prisma.socioCreateCalls[0]?.data.domicilioCalle, "Belgrano");
    assert.equal(prisma.socioCreateCalls[0]?.data.domicilioNroPuerta, "1500");
    assert.equal(prisma.socioCreateCalls[0]?.data.domicilioLocalidad, "12");
    assert.equal(
      prisma.socioCreateCalls[0]?.data.domicilioCodigoPostal,
      "2300",
    );
  });

  it("updates domicilio fields for persona fisica", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.update("socio-1", {
      domicilioCalle: "Belgrano",
      domicilioCodigoPostal: "3000",
      domicilioLocalidad: "5",
      domicilioNroPuerta: "100",
      tipoPersona: "FISICA",
    });

    assert.deepEqual(prisma.socioUpdateCalls[0]?.data, {
      domicilioCalle: "Belgrano",
      domicilioCodigoPostal: "3000",
      domicilioLocalidad: "5",
      domicilioNroPuerta: "100",
    });
  });

  it("finds by cuit excluding the current id", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.findByCuit("20123456783", "socio-1");

    assert.deepEqual(prisma.socioFindFirstCalls[0], {
      where: {
        NOT: {
          id: "socio-1",
        },
        cuit: "20123456783",
      },
    });
  });

  it("finds by documento excluding the current id", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.findByDocumento("12345678", "socio-1");

    assert.deepEqual(prisma.socioFindFirstCalls[0], {
      where: {
        NOT: {
          id: "socio-1",
        },
        nroDocumento: "12345678",
      },
    });
  });

  it("lists socios ordered by createdAt desc, paginated", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    const socios = await datasource.list({ limit: 20, offset: 0 });

    assert.deepEqual(prisma.socioFindManyCalls[0], {
      orderBy: {
        createdAt: "desc",
      },
      skip: 0,
      take: 20,
    });
    assert.equal(socios.length, 2);
    assert.equal(socios[0]?.id, "socio-2");
  });

  it("filters by search term across nombre/apellido/razonSocial/nroDocumento/cuit", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.list({ limit: 20, offset: 0, search: "  Perez  " });

    assert.deepEqual(prisma.socioFindManyCalls[0], {
      orderBy: {
        createdAt: "desc",
      },
      skip: 0,
      take: 20,
      where: {
        OR: [
          { nombre: { contains: "Perez", mode: "insensitive" } },
          { apellido: { contains: "Perez", mode: "insensitive" } },
          { razonSocial: { contains: "Perez", mode: "insensitive" } },
          { nroDocumento: { contains: "Perez" } },
          { cuit: { contains: "Perez" } },
        ],
      },
    });
  });

  it("counts socios without a search filter", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    const total = await datasource.count({});

    assert.deepEqual(prisma.socioCountCalls[0], {});
    assert.equal(total, 2);
  });

  it("counts socios matching the same search filter used by list", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.count({ search: "  Perez  " });

    assert.deepEqual(prisma.socioCountCalls[0], {
      where: {
        OR: [
          { nombre: { contains: "Perez", mode: "insensitive" } },
          { apellido: { contains: "Perez", mode: "insensitive" } },
          { razonSocial: { contains: "Perez", mode: "insensitive" } },
          { nroDocumento: { contains: "Perez" } },
          { cuit: { contains: "Perez" } },
        ],
      },
    });
  });

  it("looks up socios by documento or cuit using a single query", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    await datasource.lookupByDocumento("12345678", "DNI");

    assert.deepEqual(prisma.socioFindManyCalls[0], {
      orderBy: {
        createdAt: "desc",
      },
      where: {
        OR: [
          {
            nroDocumento: "12345678",
            tipoDocumento: "DNI",
            tipoPersona: "FISICA",
          },
          {
            cuit: "12345678",
            tipoPersona: "JURIDICA",
          },
        ],
      },
    });
  });

  it("maps unique cuit conflicts to SocioCuitDuplicateError", async () => {
    const prisma = createPrismaClient({ createConflictTarget: ["socios_cuit_key"] });
    const datasource = new SociosPrismaDatasource(prisma as never);

    await assert.rejects(
      () =>
        datasource.create({
          apellido: null,
          celular: null,
          cuit: "30123456789",
          domicilioCalle: "Belgrano",
          domicilioCodigoPostal: "2300",
          domicilioLocalidad: "12",
          domicilioNroPuerta: "1500",
          email: null,
          fechaDeNacimiento: null,
          nombre: null,
          nroDocumento: null,
          nroSocioLegacy: null,
          razonSocial: "ACME SA",
          sexo: null,
          tipoDocumento: null,
          tipoPersona: "JURIDICA",
        }),
      SocioCuitDuplicateError,
    );
  });

  it("maps unique documento conflicts to SocioDocumentoDuplicateError", async () => {
    const prisma = createPrismaClient({
      updateConflictTarget: ["socios_nro_documento_key"],
    });
    const datasource = new SociosPrismaDatasource(prisma as never);

    await assert.rejects(
      () =>
        datasource.update("socio-1", {
          nroDocumento: "99999999",
          tipoPersona: "FISICA",
        }),
      SocioDocumentoDuplicateError,
    );
  });

  it("upserts legacy rows in batches via $executeRawUnsafe and sums affected rows", async () => {
    const prisma = createPrismaClient();
    const datasource = new SociosPrismaDatasource(prisma as never);

    const rows = [
      {
        apellido: "Perez",
        celular: null,
        cuit: "20409126419",
        email: null,
        fechaDeNacimiento: "1985-03-10",
        nombre: "Juan",
        nroDocumento: "20409126",
        nroSocioLegacy: "1",
        razonSocial: null,
        sexo: "1",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA" as const,
      },
      {
        apellido: null,
        celular: null,
        cuit: "30712345678",
        email: null,
        fechaDeNacimiento: null,
        nombre: null,
        nroDocumento: null,
        nroSocioLegacy: "2",
        razonSocial: "Constructora SA",
        sexo: null,
        tipoDocumento: null,
        tipoPersona: "JURIDICA" as const,
      },
    ];

    const affected = await datasource.upsertManyFromLegacy(rows, 1);

    assert.equal(prisma.executeRawUnsafeCalls.length, 2);
    assert.match(prisma.executeRawUnsafeCalls[0], /ON CONFLICT \("cuit"\) DO UPDATE SET/);
    assert.equal(affected, 2);
  });
});

describe("SociosPrismaDatasource integration", () => {
  it("rejects incomplete persona fisica rows through the database CHECK", async () => {
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await tx.socio.create({
            data: {
              apellido: "Perez",
              cuit: "78189300001",
              fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
              nombre: "Juan",
              nroDocumento: crypto.randomUUID().replaceAll("-", "").slice(0, 8),
              razonSocial: null,
              sexo: "M",
              tipoDocumento: null,
              tipoPersona: "FISICA",
            },
          });
        }),
      isCheckConstraintError,
    );
  });

  it("rejects persona juridica rows with physical fields through the database CHECK", async () => {
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await tx.socio.create({
            data: {
              apellido: null,
              cuit: "78189300002",
              fechaDeNacimiento: null,
              nombre: null,
              nroDocumento: "12345678",
              razonSocial: "ACME SA",
              sexo: null,
              tipoDocumento: null,
              tipoPersona: "JURIDICA",
            },
          });
        }),
      isCheckConstraintError,
    );
  });

  it("rejects duplicate cuit directly in database", async () => {
    const cuit = "78189300003";

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await tx.socio.create({
            data: buildFisicaInsert({
              cuit,
              nroDocumento: "91000001",
            }),
          });
          await tx.socio.create({
            data: buildFisicaInsert({
              cuit,
              nroDocumento: "91000002",
            }),
          });
        }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
  });

  it("rejects duplicate documento directly in database", async () => {
    const nroDocumento = "91000003";

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await tx.socio.create({
            data: buildFisicaInsert({
              cuit: "78189300004",
              nroDocumento,
            }),
          });
          await tx.socio.create({
            data: buildFisicaInsert({
              cuit: "78189300005",
              nroDocumento,
            }),
          });
        }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
  });

  it("lists socios ordered by createdAt desc against the real datasource", async () => {
    const rollbackToken = new Error("rollback");

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          const older = await tx.socio.create({
            data: buildFisicaInsert({
              createdAt: new Date("2098-01-01T00:00:00.000Z"),
              cuit: "78189300006",
              nroDocumento: "91000004",
              updatedAt: new Date("2098-01-01T00:00:00.000Z"),
            }),
          });
          const newer = await tx.socio.create({
            data: buildFisicaInsert({
              createdAt: new Date("2099-01-01T00:00:00.000Z"),
              cuit: "78189300007",
              nroDocumento: "91000005",
              updatedAt: new Date("2099-01-01T00:00:00.000Z"),
            }),
          });
          const datasource = new SociosPrismaDatasource(tx as never);
          const socios = await datasource.list({ limit: 20, offset: 0 });

          assert.equal(socios[0]?.id, newer.id);
          assert.equal(socios[1]?.id, older.id);

          throw rollbackToken;
        }),
      rollbackToken,
    );
  });
});

function createPrismaClient(options?: {
  createConflictTarget?: string[];
  updateConflictTarget?: string[];
}) {
  const socioFindFirstCalls: Array<{ where: Record<string, unknown> }> = [];
  const socioFindManyCalls: Array<Record<string, unknown>> = [];
  const socioCountCalls: Array<Record<string, unknown>> = [];
  const socioCreateCalls: Array<{ data: Record<string, unknown> }> = [];
  const socioUpdateCalls: Array<{
    data: Record<string, unknown>;
    where: { id: string };
  }> = [];
  const executeRawUnsafeCalls: string[] = [];

  const records = [
    socioPrismaRecord({
      createdAt: new Date("2026-06-18T18:00:00.000Z"),
      id: "socio-1",
      updatedAt: new Date("2026-06-18T18:00:00.000Z"),
    }),
    socioPrismaRecord({
      apellido: null,
      createdAt: new Date("2026-06-19T18:00:00.000Z"),
      cuit: "30123456789",
      fechaDeNacimiento: null,
      id: "socio-2",
      nombre: null,
      nroDocumento: null,
      razonSocial: "ACME SA",
      sexo: null,
      tipoDocumento: null,
      tipoPersona: "JURIDICA",
      updatedAt: new Date("2026-06-19T18:00:00.000Z"),
    }),
  ];

  return {
    socioCreateCalls,
    socioFindFirstCalls,
    socioFindManyCalls,
    socioCountCalls,
    socioUpdateCalls,
    executeRawUnsafeCalls,
    $executeRawUnsafe: async (sql: string) => {
      executeRawUnsafeCalls.push(sql);
      // Cada fila de la tupla VALUES arranca con gen_random_uuid() -- contarlas
      // simula el "rows affected" que devolveria $executeRawUnsafe real.
      return (sql.match(/gen_random_uuid\(\)/g) ?? []).length;
    },
    socio: {
      create: async (input: { data: Record<string, unknown> }) => {
        socioCreateCalls.push(input);

        if (options?.createConflictTarget) {
          throw createKnownRequestError(options.createConflictTarget);
        }

        return socioPrismaRecord(input.data);
      },
      delete: async () => undefined,
      findFirst: async (input: { where: Record<string, unknown> }) => {
        socioFindFirstCalls.push(input);
        return records[0];
      },
      findMany: async (input: { orderBy: { createdAt: string } }) => {
        socioFindManyCalls.push(input);
        return [records[1], records[0]];
      },
      count: async (input: Record<string, unknown>) => {
        socioCountCalls.push(input);
        return records.length;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        records.find((record) => record.id === where.id) ?? null,
      update: async (input: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        socioUpdateCalls.push(input);

        if (options?.updateConflictTarget) {
          throw createKnownRequestError(options.updateConflictTarget);
        }

        return socioPrismaRecord({
          ...records[0],
          ...input.data,
          id: input.where.id,
        });
      },
    },
  };
}

function createKnownRequestError(target: string[]) {
  return {
    code: "P2002",
    meta: {
      target,
    },
  };
}

function socioPrismaRecord(overrides: Record<string, unknown> = {}) {
  return {
    apellido: "Perez",
    celular: null,
    createdAt: new Date("2026-06-18T18:00:00.000Z"),
    cuit: "20123456783",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: null,
    fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
    id: "socio-1",
    nombre: "Juan",
    nroDocumento: "12345678",
    nroSocioLegacy: null,
    razonSocial: null,
    sexo: "M",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA",
    updatedAt: new Date("2026-06-18T18:00:00.000Z"),
    ...overrides,
  };
}

function buildFisicaInsert(overrides: Record<string, unknown>) {
  return {
    apellido: "Perez",
    createdAt: new Date("2090-01-01T00:00:00.000Z"),
    cuit: "78189309999",
    fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
    nombre: "Juan",
    nroDocumento: crypto.randomUUID().replaceAll("-", "").slice(0, 8),
    razonSocial: null,
    sexo: "M",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA" as const,
    updatedAt: new Date("2090-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function isCheckConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes("socios_tipo_persona_check")
  );
}
