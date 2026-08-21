import type { SolicitudFieldAccessAdminRepository } from "../../domain/repositories/SolicitudFieldAccessAdminRepository";
import {
  FIELD_ACCESS_ALLOWED_DEFAULT_MODES,
  FIELD_ACCESS_BLOCKED_FIELDS,
  FIELD_ACCESS_CATALOG,
  FIELD_ACCESS_GROUP_ORDER,
  getFieldAccessReadonlyReason,
} from "../services/SolicitudFieldAccessAdminCatalog";

type Dependencies = {
  repository: SolicitudFieldAccessAdminRepository;
};

export class GetFieldAccessFieldCatalogUseCase {
  private readonly repository: SolicitudFieldAccessAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute() {
    const states = await this.repository.findAllStates();

    return {
      allowedDefaultModes: [...FIELD_ACCESS_ALLOWED_DEFAULT_MODES],
      blockedFields: [...FIELD_ACCESS_BLOCKED_FIELDS],
      defaultReadonlyReason: getFieldAccessReadonlyReason(),
      fieldCatalog: {
        conyuge: [...FIELD_ACCESS_CATALOG.conyuge],
        datosLaborales: [...FIELD_ACCESS_CATALOG.datosLaborales],
        garantias: [...FIELD_ACCESS_CATALOG.garantias],
        solicitud: [...FIELD_ACCESS_CATALOG.solicitud],
        titular: [...FIELD_ACCESS_CATALOG.titular],
      },
      groupCatalog: [...FIELD_ACCESS_GROUP_ORDER],
      states,
    };
  }
}
