import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import {
  ForbiddenSolicitudAccessError,
  LegacyLineaPrestamoUnavailableError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type {
  SolicitudesCoreRepository,
  UpdateSolicitudCorePatch,
} from "../../domain/repositories/SolicitudesCoreRepository";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";
import {
  assertPatchMatchesFieldAccess,
  buildSolicitudFieldAccess,
} from "../services/SolicitudFieldAccess";
import { canEditSolicitud } from "../services/SolicitudPermissions";

type Dependencies = {
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  lineasPrestamoCatalog: LineasPrestamoCatalog;
  repository: SolicitudesCoreRepository;
};

export class UpdateSolicitudUseCase {
  private readonly fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  private readonly lineasPrestamoCatalog: LineasPrestamoCatalog;
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.fieldAccessRulesRepository = dependencies.fieldAccessRulesRepository;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.repository = dependencies.repository;
  }

  async execute(input: UpdateSolicitudInput) {
    const solicitud = await this.repository.findById(input.id);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    if (!canEditSolicitud(input.currentUser, solicitud, "EDIT_DATA")) {
      throw new ForbiddenSolicitudAccessError();
    }

    const fieldAccessRule =
      await this.fieldAccessRulesRepository.findByWorkflowStateId(
        solicitud.estadoActual.id,
      );
    const fieldAccess = buildSolicitudFieldAccess(
      solicitud,
      fieldAccessRule,
      input.currentUser.isSystemAdmin,
      input.currentUser.isAnalista,
    );
    assertPatchMatchesFieldAccess(input, fieldAccess, solicitud);

    const patch: UpdateSolicitudCorePatch = {};

    if (input.solicitud) {
      patch.solicitud = { ...input.solicitud };

      if (input.solicitud.fechaPrimerVencimiento !== undefined) {
        patch.solicitud.fechaPrimerVencimiento =
          input.solicitud.fechaPrimerVencimiento;
      }

      if (input.solicitud.lineaPrestamoLegacyOid) {
        const lineaPrestamo =
          await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
            input.createdByLegacyUser,
            input.solicitud.lineaPrestamoLegacyOid,
          );

        if (!lineaPrestamo || !lineaPrestamo.vigente) {
          throw new LegacyLineaPrestamoUnavailableError();
        }

        patch.solicitud.lineaPrestamoDescripcion = lineaPrestamo.descripcion;
        patch.solicitud.lineaPrestamoLegacyOid = lineaPrestamo.legacyOid;
      }
    }

    if (input.titular) {
      patch.titular = { ...input.titular };
    }

    if (input.datosLaborales) {
      patch.datosLaborales = { ...input.datosLaborales };
    }

    if (input.conyuge !== undefined) {
      patch.conyuge = input.conyuge === null ? null : { ...input.conyuge };
    }

    if (input.garantias !== undefined) {
      patch.garantias = input.garantias.map((garantia) => ({
        antiguedadLaboralMeses: garantia.antiguedadLaboralMeses ?? null,
        casadoConTitular: garantia.casadoConTitular ?? null,
        celular: garantia.celular ?? null,
        cuit: garantia.cuit ?? null,
        denominacion: garantia.denominacion ?? null,
        domicilio: garantia.domicilio ?? null,
        edad: garantia.edad ?? null,
        email: garantia.email ?? null,
        estadoCivil: garantia.estadoCivil ?? null,
        fechaIngresoLaboral: garantia.fechaIngresoLaboral ?? null,
        fechaNacimiento: garantia.fechaNacimiento ?? null,
        ingresoMensual: garantia.ingresoMensual ?? null,
        nacionalidad: garantia.nacionalidad ?? null,
        nombre: garantia.nombre ?? null,
        nombreCompleto: garantia.nombreCompleto ?? null,
        nroDocumento: garantia.nroDocumento ?? null,
        nroSocio: garantia.nroSocio ?? null,
        observaciones: garantia.observaciones ?? null,
        ocupacion: garantia.ocupacion ?? null,
        persona: garantia.persona ?? null,
        sexo: garantia.sexo ?? null,
        sumaIngresos: garantia.sumaIngresos ?? false,
        telefono: garantia.telefono ?? null,
        tipoDocumento: garantia.tipoDocumento ?? null,
        tipoGarantia: garantia.tipoGarantia ?? null,
        tipoRelacion: garantia.tipoRelacion ?? null,
      }));
    }

    return this.repository.update(input.id, patch);
  }
}
