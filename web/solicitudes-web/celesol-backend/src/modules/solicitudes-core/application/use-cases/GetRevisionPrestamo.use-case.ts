import type { CreatePrestamoLegacyInput } from "../dtos/CreatePrestamoLegacy.dto";
import { FindSolicitudTitularSocio } from "../services/FindSolicitudTitularSocio";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { LineaPrestamoLegacyIdResolver } from "../../domain/services/LineaPrestamoLegacyIdResolver";
import type { PrestamosSimulacionGateway } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
  SolicitudLineaPrestamoLegacyIdUnresolvedError,
} from "../../domain/solicitudes-core-errors";

type Dependencies = {
  repository: Pick<SolicitudesCoreRepository, "findById">;
  sociosRepository: SocioRepository;
  lineaPrestamoLegacyIdResolver: LineaPrestamoLegacyIdResolver;
  gateway: Pick<PrestamosSimulacionGateway, "simularRevision">;
};

/** Consulta independiente: nunca llama a CrearPrestamo ni escribe la solicitud. */
export class GetRevisionPrestamoUseCase {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: CreatePrestamoLegacyInput) {
    const {
      repository,
      sociosRepository,
      lineaPrestamoLegacyIdResolver,
      gateway,
    } = this.dependencies;
    const solicitud = await repository.findById(input.solicitudId);
    if (!solicitud) throw new SolicitudCoreNotFoundError();
    // Mismo permiso de área que la generación, sobre la identidad efectiva.
    if (
      !input.currentUser.isSystemAdmin &&
      (!solicitud.estadoActual.ownerId ||
        solicitud.estadoActual.ownerId !== input.currentUser.workflowOwnerId)
    ) {
      throw new ForbiddenSolicitudAccessError();
    }
    const socio = await new FindSolicitudTitularSocio({
      sociosRepository,
    }).execute(solicitud.titular);
    const titular = {
      nombreCompleto: socio
        ? socio.tipoPersona === "JURIDICA"
          ? socio.razonSocial
          : [socio.apellido, socio.nombre].filter(Boolean).join(" ")
        : null,
      nroSocio: socio?.nroSocioLegacy ?? null,
    };
    const condiciones = {
      lineaDescripcion: solicitud.lineaPrestamoDescripcion,
      montoAFinanciar: solicitud.montoAFinanciar,
      cuotas: solicitud.cuotas,
    };
    if (solicitud.montoAFinanciar === null || solicitud.cuotas === null) {
      return { titular, condiciones, calculo: null };
    }
    // Verifica la misma relación que usa CrearPrestamo, sin confundir los IDs.
    const linea = await lineaPrestamoLegacyIdResolver.resolveByPresolicitudOid(
      solicitud.lineaPrestamoLegacyOid,
    );
    const oid = Number(solicitud.lineaPrestamoLegacyOid);
    if (!linea || !Number.isSafeInteger(oid) || oid <= 0) {
      throw new SolicitudLineaPrestamoLegacyIdUnresolvedError(
        solicitud.lineaPrestamoDescripcion,
      );
    }
    // /api/prestamos/simulacion usa el OID de presolicitud, como el simulador.
    // CrearPrestamo usa linea.id; deliberadamente no lo enviamos a simulación.
    const calculo = await gateway.simularRevision({
      capitalPuro: false,
      lineaId: oid,
      montoAFinanciar: solicitud.montoAFinanciar,
      cuotas: solicitud.cuotas,
      // Sin tasa ni fecha manual: las determina el sistema.
    });
    return { titular, condiciones, calculo };
  }
}
