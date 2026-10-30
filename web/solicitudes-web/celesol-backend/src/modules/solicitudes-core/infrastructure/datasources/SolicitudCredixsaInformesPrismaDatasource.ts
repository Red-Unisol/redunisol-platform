import type { Prisma } from "@prisma/client";

import type { DbClient } from "../../../../db/prisma";
import {
  ESTADOS_QUE_BORRAN_INFORME_CREDIXSA,
  type InformeCredixsaGuardado,
} from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import { fechaNacimientoDelInforme } from "../../application/services/fechaNacimientoCredixsa";

export class SolicitudCredixsaInformesPrismaDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async findBySolicitudId(
    solicitudId: string,
  ): Promise<InformeCredixsaGuardado | null> {
    const registro = await this.prisma.solicitudCredixsaInforme.findUnique({
      where: {
        solicitudId,
      },
    });

    if (!registro) {
      return null;
    }

    return {
      consultadoEn: registro.consultadoEn,
      cuit: registro.cuit,
      informe: registro.informe,
      nombre: registro.nombre,
      status: registro.status,
    };
  }

  async guardar(solicitudId: string, informe: InformeCredixsaGuardado) {
    const datos = {
      consultadoEn: informe.consultadoEn,
      cuit: informe.cuit,
      informe: informe.informe as Prisma.InputJsonValue,
      nombre: informe.nombre,
      status: informe.status,
    };

    await this.prisma.$transaction(async (tx) => {
      // La consulta al crear la solicitud vuelve en segundo plano, a veces
      // minutos despues. Si en el medio la desestimaron, guardar ahora
      // resucitaria el informe que el cambio de estado acaba de borrar.
      //
      // FOR UPDATE ordena las dos operaciones: el cambio de estado bloquea
      // esta misma fila al actualizarla, asi que o esperamos su commit y
      // leemos el estado nuevo, o el espera el nuestro y borra lo guardado.
      const filas = await tx.$queryRaw<Array<{ code: string }>>`
        SELECT ws."code"
        FROM "solicitudes" s
        JOIN "workflow_states" ws ON ws."id" = s."estado_actual_id"
        WHERE s."id" = ${solicitudId}::uuid
        FOR UPDATE OF s
      `;
      const estado = filas[0]?.code;

      if (!estado || ESTADOS_QUE_BORRAN_INFORME_CREDIXSA.includes(estado)) {
        return;
      }

      await tx.solicitudCredixsaInforme.upsert({
        create: {
          ...datos,
          solicitudId,
        },
        update: datos,
        where: {
          solicitudId,
        },
      });

      // La fecha de nacimiento de CredixSA es la verdadera: pisa la que cargo
      // el vendedor (solo si el informe es del titular).
      const titular = await tx.solicitudTitular.findUnique({
        select: { cuit: true, nroDocumento: true },
        where: { solicitudId },
      });
      const fechaNacimiento = titular
        ? fechaNacimientoDelInforme(informe.informe, titular)
        : null;

      if (fechaNacimiento) {
        await tx.solicitudTitular.update({
          data: { fechaNacimiento },
          where: { solicitudId },
        });
      }
    });
  }
}
