import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import {
  ForbiddenSolicitudAccessError,
  LineaPrestamoNoDisponibleParaSolicitudError,
  SolicitudCoreNotFoundError,
  SolicitudFueraDeLimitesDeLineaError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type {
  SolicitudesCoreRepository,
  UpdateSolicitudCorePatch,
} from "../../domain/repositories/SolicitudesCoreRepository";
import type {
  LegacyLineaPrestamo,
  LineasPrestamoCatalog,
} from "../../domain/services/LineasPrestamoCatalog";
import {
  assertPatchMatchesFieldAccess,
  buildSolicitudFieldAccess,
} from "../services/SolicitudFieldAccess";
import { canEditSolicitud } from "../services/SolicitudPermissions";
import type { SimularCuotaSolicitud } from "../services/SimularCuotaSolicitud";

type Dependencies = {
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  lineasPrestamoCatalog: LineasPrestamoCatalog;
  repository: SolicitudesCoreRepository;
  simularCuotaSolicitud: Pick<SimularCuotaSolicitud, "execute">;
};

export class UpdateSolicitudUseCase {
  private readonly fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  private readonly lineasPrestamoCatalog: LineasPrestamoCatalog;
  private readonly repository: SolicitudesCoreRepository;
  private readonly simularCuotaSolicitud: Pick<SimularCuotaSolicitud, "execute">;

  constructor(dependencies: Dependencies) {
    this.fieldAccessRulesRepository = dependencies.fieldAccessRulesRepository;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.repository = dependencies.repository;
    this.simularCuotaSolicitud = dependencies.simularCuotaSolicitud;
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

      if (
        input.solicitud.lineaPrestamoLegacyOid &&
        input.solicitud.lineaPrestamoLegacyOid !==
          solicitud.lineaPrestamoLegacyOid
      ) {
        // Las lineas posibles son las del agente del vendedor de la
        // solicitud, no las de quien la edita: RIESGO no tiene que mezclar
        // convenios.
        const vendedorLegacyUser =
          (await this.repository.findVendedorLegacyUser?.(solicitud.id)) ??
          input.createdByLegacyUser;
        const lineaPrestamo =
          await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
            vendedorLegacyUser,
            input.solicitud.lineaPrestamoLegacyOid,
          );

        if (!lineaPrestamo || !lineaPrestamo.vigente) {
          throw new LineaPrestamoNoDisponibleParaSolicitudError();
        }

        assertSolicitudDentroDeLimitesDeLinea(lineaPrestamo, {
          cuotas:
            input.solicitud.cuotas !== undefined
              ? input.solicitud.cuotas
              : solicitud.cuotas,
          montoAFinanciar:
            input.solicitud.montoAFinanciar !== undefined
              ? input.solicitud.montoAFinanciar
              : solicitud.montoAFinanciar,
        });

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

    await this.recalcularCuotaResultante(patch, solicitud);

    return this.repository.update(input.id, patch);
  }

  /**
   * Si la edicion toca alguno de los datos que determinan la cuota, se vuelve
   * a pedir al legado. Sin esto, cambiar el monto o las cuotas dejaria una
   * cuota resultante vieja -- peor que no tenerla, porque parece correcta.
   *
   * Solo se recalcula cuando alguno de esos campos viene en el patch: editar
   * un telefono no tiene por que golpear al legado.
   */
  private async recalcularCuotaResultante(
    patch: UpdateSolicitudCorePatch,
    solicitud: { cuotas: number | null; fechaPrimerVencimiento?: string | null; lineaPrestamoLegacyOid: string; montoAFinanciar: number | null },
  ) {
    const cambios = patch.solicitud;

    if (
      !cambios ||
      (cambios.cuotas === undefined &&
        cambios.montoAFinanciar === undefined &&
        cambios.lineaPrestamoLegacyOid === undefined &&
        cambios.fechaPrimerVencimiento === undefined)
    ) {
      return;
    }

    const simulacion = await this.simularCuotaSolicitud.execute({
      cuotas: cambios.cuotas !== undefined ? cambios.cuotas : solicitud.cuotas,
      fechaPrimerVencimiento:
        cambios.fechaPrimerVencimiento !== undefined
          ? cambios.fechaPrimerVencimiento
          : (solicitud.fechaPrimerVencimiento ?? null),
      lineaPrestamoLegacyOid:
        cambios.lineaPrestamoLegacyOid !== undefined
          ? cambios.lineaPrestamoLegacyOid
          : solicitud.lineaPrestamoLegacyOid,
      montoAFinanciar:
        cambios.montoAFinanciar !== undefined
          ? cambios.montoAFinanciar
          : solicitud.montoAFinanciar,
    });

    if (!simulacion) {
      return;
    }

    cambios.cuotaResultante = simulacion.cuotaResultante;
    cambios.fechaPrimerVencimiento = simulacion.fechaPrimerVencimiento;
  }
}

/**
 * Al cambiar la linea, las cuotas y el monto que ya tenia la solicitud tienen
 * que entrar en los limites de la nueva. Mismos mensajes que el formulario.
 */
function assertSolicitudDentroDeLimitesDeLinea(
  linea: LegacyLineaPrestamo,
  valores: { cuotas: number | null; montoAFinanciar: number | null },
) {
  const { cuotas, montoAFinanciar } = valores;
  const minCuotas = linea.cantidadMinimaCuotas ?? null;
  const maxCuotas = linea.cantidadMaximaCuotas ?? null;
  const minMonto = linea.montoMinimo ?? null;
  const maxMonto = linea.montoMaximo ?? null;

  if (cuotas !== null && minCuotas !== null && cuotas < minCuotas) {
    throw new SolicitudFueraDeLimitesDeLineaError(
      `La línea requiere al menos ${minCuotas} cuotas.`,
    );
  }

  if (cuotas !== null && maxCuotas !== null && cuotas > maxCuotas) {
    throw new SolicitudFueraDeLimitesDeLineaError(
      `La línea permite hasta ${maxCuotas} cuotas.`,
    );
  }

  if (montoAFinanciar !== null && minMonto && montoAFinanciar < minMonto) {
    throw new SolicitudFueraDeLimitesDeLineaError(
      `La línea requiere financiar al menos ${formatMonto(minMonto)}.`,
    );
  }

  if (montoAFinanciar !== null && maxMonto && montoAFinanciar > maxMonto) {
    throw new SolicitudFueraDeLimitesDeLineaError(
      `La línea permite financiar hasta ${formatMonto(maxMonto)}.`,
    );
  }
}

function formatMonto(value: number) {
  return `$${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
