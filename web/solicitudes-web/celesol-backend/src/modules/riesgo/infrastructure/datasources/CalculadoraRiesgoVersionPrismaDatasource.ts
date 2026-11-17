import type { Prisma } from "@prisma/client";

import type { DbClient } from "../../../../db/prisma";
import {
  CALCULADORA_VERSIONES_A_CONSERVAR,
  type CalculadoraRiesgoVersionConContenido,
  type CalculadoraRiesgoVersionRepository,
  type CalculadoraRiesgoVersionResumen,
  type GuardarCalculadoraRiesgoVersionInput,
} from "../../domain/repositories/CalculadoraRiesgoVersionRepository";

const USUARIO = {
  select: { firstName: true, id: true, lastName: true, legacyUser: true },
} as const;

const RESUMEN_SELECT = {
  cargadaEn: true,
  cargadaPor: USUARIO,
  id: true,
  origen: true,
  restauradaDeId: true,
  resumenCambios: true,
  sha256: true,
  vigente: true,
} as const;

type FilaResumen = Prisma.CalculadoraRiesgoVersionGetPayload<{
  select: typeof RESUMEN_SELECT;
}>;

export class CalculadoraRiesgoVersionPrismaDatasource
  implements CalculadoraRiesgoVersionRepository
{
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async findVigente() {
    const fila = await this.prisma.calculadoraRiesgoVersion.findFirst({
      select: { ...RESUMEN_SELECT, contenido: true },
      where: { vigente: true },
    });

    return fila ? conContenido(fila) : null;
  }

  async findById(id: string) {
    const fila = await this.prisma.calculadoraRiesgoVersion.findUnique({
      select: { ...RESUMEN_SELECT, contenido: true },
      where: { id },
    });

    return fila ? conContenido(fila) : null;
  }

  async listar() {
    const filas = await this.prisma.calculadoraRiesgoVersion.findMany({
      orderBy: { cargadaEn: "desc" },
      select: RESUMEN_SELECT,
    });

    return filas.map(aResumen);
  }

  async guardarComoVigente(input: GuardarCalculadoraRiesgoVersionInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.calculadoraRiesgoVersion.updateMany({
        data: { vigente: false },
        where: { vigente: true },
      });

      const creada = await tx.calculadoraRiesgoVersion.create({
        data: {
          cargadaEn: input.cargadaEn,
          cargadaPorId: input.cargadaPorId,
          contenido: new Uint8Array(input.contenido),
          origen: input.origen,
          restauradaDeId: input.restauradaDeId,
          resumenCambios: (input.resumenCambios ??
            undefined) as Prisma.InputJsonValue | undefined,
          sha256: input.sha256,
          vigente: true,
        },
        select: RESUMEN_SELECT,
      });

      const sobrantes = await tx.calculadoraRiesgoVersion.findMany({
        orderBy: { cargadaEn: "desc" },
        select: { id: true },
        skip: CALCULADORA_VERSIONES_A_CONSERVAR,
      });

      if (sobrantes.length > 0) {
        await tx.calculadoraRiesgoVersion.deleteMany({
          where: { id: { in: sobrantes.map((fila) => fila.id) } },
        });
      }

      return aResumen(creada);
    });
  }
}

function aResumen(fila: FilaResumen): CalculadoraRiesgoVersionResumen {
  const usuario = fila.cargadaPor;
  const nombre = usuario
    ? [usuario.firstName?.trim(), usuario.lastName?.trim()]
        .filter(Boolean)
        .join(" ")
    : "";

  return {
    cargadaEn: fila.cargadaEn,
    cargadaPor: usuario
      ? { id: usuario.id, nombre: nombre || usuario.legacyUser }
      : null,
    id: fila.id,
    origen: fila.origen,
    restauradaDeId: fila.restauradaDeId,
    resumenCambios: fila.resumenCambios,
    sha256: fila.sha256,
    vigente: fila.vigente,
  };
}

function conContenido(
  fila: FilaResumen & { contenido: Uint8Array },
): CalculadoraRiesgoVersionConContenido {
  return { ...aResumen(fila), contenido: Buffer.from(fila.contenido) };
}
