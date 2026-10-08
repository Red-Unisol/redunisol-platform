import type { DbClient } from "../../../../db/prisma";
import type {
  EvaluacionRiesgoGuardada,
  EvaluacionRiesgoRepository,
  GuardarEvaluacionRiesgoInput,
} from "../../domain/repositories/EvaluacionRiesgoRepository";

export class EvaluacionRiesgoPrismaDatasource
  implements EvaluacionRiesgoRepository
{
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async findEstadoActualDeSolicitud(solicitudId: string) {
    const solicitud = await this.prisma.solicitud.findUnique({
      select: {
        estadoActual: {
          select: { code: true, id: true, name: true, ownerId: true },
        },
      },
      where: { id: solicitudId },
    });

    return solicitud?.estadoActual ?? null;
  }

  async findBySolicitudId(
    solicitudId: string,
  ): Promise<EvaluacionRiesgoGuardada | null> {
    const registro = await this.prisma.solicitudEvaluacionRiesgo.findUnique({
      include: {
        guardadaPor: {
          select: { firstName: true, id: true, lastName: true, legacyUser: true },
        },
      },
      where: { solicitudId },
    });

    if (!registro) {
      return null;
    }

    const usuario = registro.guardadaPor;
    const nombreCompleto = usuario
      ? [usuario.firstName?.trim(), usuario.lastName?.trim()]
          .filter(Boolean)
          .join(" ")
      : "";

    return {
      guardadaEn: registro.guardadaEn,
      guardadaPor: usuario
        ? { id: usuario.id, nombre: nombreCompleto || usuario.legacyUser }
        : null,
      nivelRiesgo: registro.nivelRiesgo,
      storageBucket: registro.storageBucket,
      storageKey: registro.storageKey,
    };
  }

  async guardar(solicitudId: string, input: GuardarEvaluacionRiesgoInput) {
    const datos = {
      guardadaEn: input.guardadaEn,
      guardadaPorId: input.guardadaPorId,
      nivelRiesgo: input.nivelRiesgo,
      storageBucket: input.storageBucket,
      storageKey: input.storageKey,
    };

    await this.prisma.solicitudEvaluacionRiesgo.upsert({
      create: { ...datos, solicitudId },
      update: datos,
      where: { solicitudId },
    });
  }
}
