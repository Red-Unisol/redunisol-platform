import type { PrismaClient } from "@prisma/client";
import type { ConfiguracionReconocimientoRepository } from "../domain/ReconocimientoRecibo";
export class ConfiguracionReconocimientoPrisma implements ConfiguracionReconocimientoRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async get() {
    return this.prisma.reconocimientoRecibosConfiguracion.findUniqueOrThrow({
      where: { id: "global" },
      select: { habilitado: true, version: true },
    });
  }
  async update(habilitado: boolean) {
    return this.prisma.reconocimientoRecibosConfiguracion.update({
      where: { id: "global" },
      data: { habilitado, version: { increment: 1 } },
      select: { habilitado: true, version: true },
    });
  }
}
