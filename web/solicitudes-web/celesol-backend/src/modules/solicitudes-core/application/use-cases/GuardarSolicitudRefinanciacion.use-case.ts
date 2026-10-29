import { canEditSolicitud } from "../services/SolicitudPermissions";
import {
  SolicitudCoreNotFoundError,
  SolicitudRefinanciacionInvalidaError,
  SolicitudRefinanciacionNoEditableError,
  SolicitudRefinanciacionPrestamoGeneradoError,
  SolicitudRefinanciacionYaCobradaError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type {
  SolicitudRefinanciacion,
  SolicitudRefinanciacionPrestamo,
  SolicitudRefinanciacionRepository,
} from "../../domain/repositories/SolicitudRefinanciacionRepository";
import { refinanciacionVersion } from "../../domain/repositories/SolicitudRefinanciacionRepository";
import type {
  RefinanciacionSimulada,
  SimularRefinanciacionUseCase,
} from "./SimularRefinanciacion.use-case";

type Dependencies = {
  fieldAccessRulesRepository: Pick<
    SolicitudFieldAccessRulesRepository,
    "findByWorkflowStateId"
  >;
  refinanciacionRepository: Pick<
    SolicitudRefinanciacionRepository,
    "findBySolicitudId" | "replace"
  >;
  repository: Pick<SolicitudesCoreRepository, "findById">;
  simularRefinanciacion: Pick<SimularRefinanciacionUseCase, "execute">;
};

export type GuardarSolicitudRefinanciacionInput = {
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerCode: string | null;
    workflowOwnerId: string | null;
  };
  prestamos: SolicitudRefinanciacionPrestamo[];
  solicitudId: string;
};

export type SolicitudRefinanciacionGuardada = SolicitudRefinanciacion & {
  /** null si se borro la seleccion: no hay nada que simular. */
  simulacion: RefinanciacionSimulada | null;
};

/**
 * Guarda las cuotas a cancelar con la refinanciacion. Antes de guardar las
 * simula en Vimarx: lo que queda guardado es algo que Vimarx acepta cobrar
 * (cuotas del titular, en orden). El cobro real se hace al generar el
 * prestamo.
 *
 * Puede editarla quien puede editar las cancelaciones; el controlador ademas
 * deja afuera a Vendedores, que no ve los prestamos del socio.
 */
export class GuardarSolicitudRefinanciacionUseCase {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    input: GuardarSolicitudRefinanciacionInput,
  ): Promise<SolicitudRefinanciacionGuardada> {
    const solicitud = await this.dependencies.repository.findById(
      input.solicitudId,
    );

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    // Con el prestamo generado, las cuotas ya se cobraron (o se tendrian que
    // haber cobrado): cambiar la seleccion no tendria efecto en Vimarx.
    if (solicitud.legacyOid) {
      throw new SolicitudRefinanciacionPrestamoGeneradoError();
    }

    const fieldAccessRule =
      await this.dependencies.fieldAccessRulesRepository.findByWorkflowStateId(
        solicitud.estadoActual.id,
      );
    const user = input.currentUser;

    if (
      !canEditSolicitud(user, solicitud, "MANAGE_CANCELACIONES", fieldAccessRule) &&
      !canEditSolicitud(user, solicitud, "CREATE_CANCELACION", fieldAccessRule)
    ) {
      throw new SolicitudRefinanciacionNoEditableError();
    }

    // Un intento anterior de generar el prestamo ya cobro cuotas en Vimarx:
    // cambiar la seleccion dejaria esos cobros sin reflejo en Sol Web.
    const actual =
      await this.dependencies.refinanciacionRepository.findBySolicitudId(
        input.solicitudId,
      );

    if (actual.prestamos.some((prestamo) => prestamo.cobros.length > 0)) {
      throw new SolicitudRefinanciacionYaCobradaError();
    }

    const prestamos = input.prestamos.map((prestamo) => ({
      nrosCuota: [...prestamo.nrosCuota].sort((a, b) => a - b),
      prestamoId: prestamo.prestamoId.trim(),
    }));
    let simulacion: RefinanciacionSimulada | null = null;

    if (prestamos.length > 0) {
      // Tambien verifica que cada prestamo sea del titular.
      simulacion = await this.dependencies.simularRefinanciacion.execute({
        prestamos,
        solicitudId: input.solicitudId,
      });

      const rechazo = simulacion.prestamos.find((prestamo) => !prestamo.ok);

      if (rechazo && !rechazo.ok) {
        throw new SolicitudRefinanciacionInvalidaError(rechazo.error);
      }
    }

    const guardada = await this.dependencies.refinanciacionRepository.replace({
      expectedSolicitudUpdatedAt: solicitud.updatedAt,
      expectedVersion: refinanciacionVersion(actual),
      prestamos,
      solicitudId: input.solicitudId,
      updatedBy: user.id,
    });

    return { ...guardada, simulacion };
  }
}
