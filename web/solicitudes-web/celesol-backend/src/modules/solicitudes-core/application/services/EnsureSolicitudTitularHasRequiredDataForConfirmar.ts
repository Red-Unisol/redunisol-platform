import {
  SolicitudCoreNotFoundError,
  SolicitudTitularDataIncompleteForConfirmarError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudCoreTitular } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  solicitudesRepository: SolicitudesCoreRepository;
};

type RequiredTitularField = {
  key: keyof SolicitudCoreTitular;
  label: string;
};

const REQUIRED_TITULAR_FIELDS: RequiredTitularField[] = [
  { key: "tipoDocumento", label: "Tipo de documento" },
  { key: "nroDocumento", label: "Nro. de documento" },
  { key: "apellidoDenominacion", label: "Apellido/Denominación" },
  { key: "nombre", label: "Nombre" },
  { key: "fechaNacimiento", label: "Fecha de nacimiento" },
  { key: "sexo", label: "Sexo" },
  { key: "cuit", label: "CUIT" },
  { key: "email", label: "Email" },
  { key: "celular", label: "Celular" },
];

export type SolicitudTitularRequiredDataCheck = {
  isComplete: boolean;
  missingLabels: string[];
};

export class EnsureSolicitudTitularHasRequiredDataForConfirmar {
  private readonly solicitudesRepository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.solicitudesRepository = dependencies.solicitudesRepository;
  }

  async check(solicitudId: string): Promise<SolicitudTitularRequiredDataCheck> {
    const solicitud = await this.solicitudesRepository.findById(solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const missingLabels = REQUIRED_TITULAR_FIELDS.filter(
      (field) => !hasValue(solicitud.titular[field.key]),
    ).map((field) => field.label);

    return {
      isComplete: missingLabels.length === 0,
      missingLabels,
    };
  }

  async execute(solicitudId: string): Promise<void> {
    const result = await this.check(solicitudId);

    if (!result.isComplete) {
      throw new SolicitudTitularDataIncompleteForConfirmarError(
        result.missingLabels,
      );
    }
  }
}

function hasValue(value: string | boolean | null | undefined): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return value !== null && value !== undefined;
}
