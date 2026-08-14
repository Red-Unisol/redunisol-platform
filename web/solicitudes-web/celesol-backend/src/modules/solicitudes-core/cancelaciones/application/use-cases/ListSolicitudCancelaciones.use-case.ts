import type { ListSolicitudCancelacionesInput } from "../dtos/ListSolicitudCancelaciones.dto";
import type { SolicitudCancelacion } from "../../domain/entities/SolicitudCancelacion.entity";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { SolicitudCancelacionNotFoundError } from "../../domain/solicitudes-cancelaciones-errors";

type ListSolicitudCancelacionesUseCaseDependencies = {
  repository: SolicitudCancelacionRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class ListSolicitudCancelacionesUseCase {
  constructor(
    private readonly dependencies: ListSolicitudCancelacionesUseCaseDependencies,
  ) {}

  async execute(
    input: ListSolicitudCancelacionesInput,
  ): Promise<SolicitudCancelacion[]> {
    const solicitud = await this.dependencies.solicitudesRepository.findById(
      input.solicitudId,
    );

    if (!solicitud) {
      throw new SolicitudCancelacionNotFoundError();
    }

    const cancelaciones = await this.dependencies.repository.listBySolicitudId(
      input.solicitudId,
    );

    return cancelaciones.filter((cancelacion) => cancelacion.deletedAt === null);
  }
}
