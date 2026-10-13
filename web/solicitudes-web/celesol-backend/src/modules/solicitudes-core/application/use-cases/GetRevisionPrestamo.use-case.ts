import { ajustarMaximosLinea } from "../services/AjustarMaximosLinea";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";
import { LegacyLineaPrestamoUnavailableError } from "../../domain/solicitudes-core-errors";
import type { CreatePrestamoLegacyInput } from "../dtos/CreatePrestamoLegacy.dto";
import { FindSolicitudTitularSocio } from "../services/FindSolicitudTitularSocio";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { PrestamosSimulacionGateway } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";

type Dependencies = {
  lineasPrestamoCatalog: LineasPrestamoCatalog;
  repository: Pick<
    SolicitudesCoreRepository,
    "findById" | "findVendedorLegacyUser"
  >;
  sociosRepository: SocioRepository;
  gateway: Pick<PrestamosSimulacionGateway, "simularRevision">;
};

/** Consulta independiente: nunca llama a CrearPrestamo ni escribe la solicitud. */
export class GetRevisionPrestamoUseCase {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: CreatePrestamoLegacyInput) {
    const { repository, sociosRepository, gateway } = this.dependencies;
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
    let titular: { nombreCompleto: string | null; nroSocio: string | null } = {
      nombreCompleto: null,
      nroSocio: null,
    };
    let errorTitular: string | null = null;
    try {
      const socio = await new FindSolicitudTitularSocio({
        sociosRepository,
      }).execute(solicitud.titular);
      titular = {
        nombreCompleto: socio
          ? socio.tipoPersona === "JURIDICA"
            ? socio.razonSocial
            : [socio.apellido, socio.nombre].filter(Boolean).join(" ")
          : null,
        nroSocio: socio?.nroSocioLegacy ?? null,
      };
    } catch {
      errorTitular = "No se pudo consultar el socio para la generación.";
    }
    const vendedor = await repository.findVendedorLegacyUser?.(solicitud.id);
    if (!vendedor) throw new LegacyLineaPrestamoUnavailableError();
    const limites =
      await this.dependencies.lineasPrestamoCatalog.findByLegacyUserAndOid(
        vendedor,
        solicitud.lineaPrestamoLegacyOid,
      );
    if (!limites || !limites.vigente)
      throw new LegacyLineaPrestamoUnavailableError();
    const efectivos = ajustarMaximosLinea(limites, solicitud);
    const condiciones = {
      lineaDescripcion: solicitud.lineaPrestamoDescripcion,
      montoAFinanciar: efectivos.montoAFinanciar as number,
      cuotas: efectivos.cuotas,
    };
    if (solicitud.montoAFinanciar === null || solicitud.cuotas === null) {
      return {
        titular,
        condiciones,
        errorTitular,
        errorCalculo: null,
        calculo: null,
      };
    }
    // La simulación usa el OID de presolicitud. La resolución del ID de préstamo
    // sigue intacta en CrearPrestamo y no es un requisito de esta consulta.
    const oid = Number(solicitud.lineaPrestamoLegacyOid);
    if (!Number.isSafeInteger(oid) || oid <= 0) {
      return {
        titular,
        condiciones,
        errorTitular,
        calculo: null,
        errorCalculo:
          "La línea de la solicitud no tiene un identificador válido para calcular.",
      };
    }
    try {
      const calculo = await gateway.simularRevision({
        capitalPuro: false,
        lineaId: oid,
        montoAFinanciar: efectivos.montoAFinanciar as number,
        cuotas: efectivos.cuotas as number,
        // La fecha y tasa de la solicitud/línea se muestran, pero no se imponen.
      });
      return {
        titular,
        condiciones,
        errorTitular,
        calculo,
        errorCalculo: null,
      };
    } catch {
      return {
        titular,
        condiciones,
        errorTitular,
        calculo: null,
        errorCalculo:
          "No se pudo obtener el cálculo. Los datos de la solicitud siguen disponibles.",
      };
    }
  }
}
