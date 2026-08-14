import { Prisma, type PrismaClient } from "@prisma/client";

import {
  SocioCuitDuplicateError,
  SocioDocumentoDuplicateError,
} from "../../domain/socios-errors";
import type { Socio } from "../../domain/entities/Socio.entity";
import type {
  CreateSocioData,
  UpdateSocioData,
} from "../../domain/types/SocioRepositoryData";
import type { MappedSocioRow } from "../../application/services/ClassifySocioMutualRow";
import { SocioMapper } from "../mappers/Socio.mapper";
import { buildSociosUpsertSql } from "../sql/BuildSociosUpsertSql";

const UPSERT_ROWS_PER_STATEMENT = 500;

type SocioPrismaDelegate = {
  count(input: { where?: Record<string, unknown> }): Promise<number>;
  create(input: { data: Record<string, unknown> }): Promise<unknown>;
  delete(input: { where: { id: string } }): Promise<void>;
  findFirst(input: { where: Record<string, unknown> }): Promise<unknown | null>;
  findMany(input: {
    where?: Record<string, unknown>;
    orderBy: {
      createdAt: "desc";
    };
    skip?: number;
    take?: number;
  }): Promise<unknown[]>;
  findUnique(input: { where: { id: string } }): Promise<unknown | null>;
  update(input: {
    data: Record<string, unknown>;
    where: { id: string };
  }): Promise<unknown>;
};

type SocioPrismaClient = PrismaClient & {
  socio: SocioPrismaDelegate;
};

function buildSearchWhere(search?: string) {
  const searchTerm = search?.trim();

  if (!searchTerm) {
    return {};
  }

  return {
    where: {
      OR: [
        { nombre: { contains: searchTerm, mode: "insensitive" as const } },
        { apellido: { contains: searchTerm, mode: "insensitive" as const } },
        { razonSocial: { contains: searchTerm, mode: "insensitive" as const } },
        { nroDocumento: { contains: searchTerm } },
        { cuit: { contains: searchTerm } },
      ],
    },
  };
}

export class SociosPrismaDatasource {
  private readonly prisma: SocioPrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma as SocioPrismaClient;
  }

  async create(input: CreateSocioData): Promise<Socio> {
    try {
      const socio = await this.prisma.socio.create({
        data: {
          apellido: input.apellido,
          celular: input.celular ?? null,
          cuit: input.cuit,
          domicilioCalle: input.domicilioCalle,
          domicilioCodigoPostal: input.domicilioCodigoPostal,
          domicilioLocalidad: input.domicilioLocalidad,
          domicilioNroPuerta: input.domicilioNroPuerta,
          email: input.email ?? null,
          fechaDeNacimiento: input.fechaDeNacimiento,
          nombre: input.nombre,
          nroDocumento: input.nroDocumento,
          nroSocioLegacy: input.nroSocioLegacy,
          razonSocial: input.razonSocial,
          sexo: input.sexo,
          tipoDocumento: input.tipoDocumento,
          tipoPersona: input.tipoPersona,
        },
      });

      return SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0]);
    } catch (error) {
      throw mapDuplicateError(error);
    }
  }

  async delete(id: string): Promise<void> {
    await this.prisma.socio.delete({
      where: {
        id,
      },
    });
  }

  async findByCuit(cuit: string, excludeId?: string): Promise<Socio | null> {
    const socio = await this.prisma.socio.findFirst({
      where: {
        ...(excludeId
          ? {
              NOT: {
                id: excludeId,
              },
            }
          : {}),
        cuit,
      },
    });

    return socio
      ? SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0])
      : null;
  }

  async findByDocumento(
    nroDocumento: string,
    excludeId?: string,
  ): Promise<Socio | null> {
    const socio = await this.prisma.socio.findFirst({
      where: {
        ...(excludeId
          ? {
              NOT: {
                id: excludeId,
              },
            }
          : {}),
        nroDocumento,
      },
    });

    return socio
      ? SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0])
      : null;
  }

  async findById(id: string): Promise<Socio | null> {
    const socio = await this.prisma.socio.findUnique({
      where: {
        id,
      },
    });

    return socio
      ? SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0])
      : null;
  }

  async count(input: { search?: string }): Promise<number> {
    return this.prisma.socio.count({
      ...buildSearchWhere(input.search),
    });
  }

  async list(input: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<Socio[]> {
    const socios = await this.prisma.socio.findMany({
      orderBy: {
        createdAt: "desc",
      },
      skip: input.offset,
      take: input.limit,
      ...buildSearchWhere(input.search),
    });

    return socios.map((socio) =>
      SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0]),
    );
  }

  async lookupByDocumento(
    documento: string,
    tipoDocumento?: string,
  ): Promise<Socio[]> {
    const socios = await this.prisma.socio.findMany({
      orderBy: {
        createdAt: "desc",
      },
      where: {
        OR: [
          {
            nroDocumento: documento,
            ...(tipoDocumento ? { tipoDocumento } : {}),
            tipoPersona: "FISICA",
          },
          {
            cuit: documento,
            tipoPersona: "JURIDICA",
          },
        ],
      },
    });

    return socios.map((socio) =>
      SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0]),
    );
  }

  async upsertManyFromLegacy(
    rows: MappedSocioRow[],
    rowsPerStatement: number = UPSERT_ROWS_PER_STATEMENT,
  ): Promise<number> {
    const statements = buildSociosUpsertSql(rows, rowsPerStatement);
    let affected = 0;

    for (const statement of statements) {
      affected += await this.prisma.$executeRawUnsafe(statement);
    }

    return affected;
  }

  async update(id: string, input: UpdateSocioData): Promise<Socio> {
    const data = buildSocioUpdateData(input);

    try {
      const socio = await this.prisma.socio.update({
        data,
        where: {
          id,
        },
      });

      return SocioMapper.toDomain(socio as Parameters<typeof SocioMapper.toDomain>[0]);
    } catch (error) {
      throw mapDuplicateError(error);
    }
  }
}

function mapDuplicateError(error: unknown): Error {
  const duplicateTarget = getDuplicateTarget(error);

  if (duplicateTarget.includes("cuit")) {
    return new SocioCuitDuplicateError();
  }

  if (
    duplicateTarget.includes("nro_documento") ||
    duplicateTarget.includes("nrodocumento")
  ) {
    return new SocioDocumentoDuplicateError();
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown persistence error.");
}

function getDuplicateTarget(error: unknown): string {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return Array.isArray(error.meta?.target) ? error.meta.target.join(",") : "";
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002" &&
    "meta" in error
  ) {
    const meta = error.meta;

    if (
      typeof meta === "object" &&
      meta !== null &&
      "target" in meta &&
      Array.isArray(meta.target)
    ) {
      return meta.target.join(",");
    }
  }

  return "";
}

function buildSocioUpdateData(input: UpdateSocioData): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (input.cuit !== undefined) {
    data.cuit = input.cuit;
  }

  if (input.celular !== undefined) {
    data.celular = input.celular;
  }

  if (input.email !== undefined) {
    data.email = input.email;
  }

  if (input.tipoPersona === "FISICA") {
    if (input.apellido !== undefined) {
      data.apellido = input.apellido;
    }

    if (input.fechaDeNacimiento !== undefined) {
      data.fechaDeNacimiento = input.fechaDeNacimiento;
    }

    if (input.nombre !== undefined) {
      data.nombre = input.nombre;
    }

    if (input.nroDocumento !== undefined) {
      data.nroDocumento = input.nroDocumento;
    }

    if (input.sexo !== undefined) {
      data.sexo = input.sexo;
    }

    if (input.tipoDocumento !== undefined) {
      data.tipoDocumento = input.tipoDocumento;
    }

    if (input.domicilioCalle !== undefined) {
      data.domicilioCalle = input.domicilioCalle;
    }

    if (input.domicilioNroPuerta !== undefined) {
      data.domicilioNroPuerta = input.domicilioNroPuerta;
    }

    if (input.domicilioLocalidad !== undefined) {
      data.domicilioLocalidad = input.domicilioLocalidad;
    }

    if (input.domicilioCodigoPostal !== undefined) {
      data.domicilioCodigoPostal = input.domicilioCodigoPostal;
    }
  }

  if (input.tipoPersona === "JURIDICA") {
    if (input.razonSocial !== undefined) {
      data.razonSocial = input.razonSocial;
    }

    if (input.domicilioCalle !== undefined) {
      data.domicilioCalle = input.domicilioCalle;
    }

    if (input.domicilioNroPuerta !== undefined) {
      data.domicilioNroPuerta = input.domicilioNroPuerta;
    }

    if (input.domicilioLocalidad !== undefined) {
      data.domicilioLocalidad = input.domicilioLocalidad;
    }

    if (input.domicilioCodigoPostal !== undefined) {
      data.domicilioCodigoPostal = input.domicilioCodigoPostal;
    }
  }

  return data;
}
