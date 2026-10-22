import { ajustarMaximosLinea } from "../services/AjustarMaximosLinea";
import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import {
  ForbiddenSolicitudAccessError,
  LineaPrestamoNoDisponibleParaSolicitudError,
  MontoSuperaAprobadoRiesgoError,
  SolicitudCoreNotFoundError,
  SolicitudFieldNotEditableInCurrentStateError,
  SolicitudFueraDeLimitesDeLineaError,
} from "../../domain/solicitudes-core-errors";
import { ESTADOS_CON_TOPE_DE_RIESGO } from "../../domain/entities/SolicitudCore.entity";
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
  private readonly simularCuotaSolicitud: Pick<
    SimularCuotaSolicitud,
    "execute"
  >;

  constructor(dependencies: Dependencies) {
    this.fieldAccessRulesRepository = dependencies.fieldAccessRulesRepository;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.repository = dependencies.repository;
    this.simularCuotaSolicitud = dependencies.simularCuotaSolicitud;
  }

  async execute(input: UpdateSolicitudInput) {
    if (input.solicitud?.cuotaResultante !== undefined)
      throw new SolicitudFieldNotEditableInCurrentStateError(
        "solicitud.cuotaResultante",
      );
    const solicitud = await this.repository.findById(input.id);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const workflowOwnerCode =
      !input.currentUser.isSystemAdmin && input.currentUser.workflowOwnerId &&
      this.repository.findWorkflowOwnerCodeById
        ? await this.repository.findWorkflowOwnerCodeById(input.currentUser.workflowOwnerId)
        : null;
    const permissionUser = { ...input.currentUser, workflowOwnerCode };
    if (!canEditSolicitud(permissionUser, solicitud, "EDIT_DATA")) {
      throw new ForbiddenSolicitudAccessError();
    }

    // El vendedor queda fijado al crear la solicitud, incluso para administradores.
    if (
      input.solicitud?.vendedorSolicitud !== undefined &&
      input.solicitud.vendedorSolicitud !== solicitud.vendedorSolicitud
    ) {
      throw new SolicitudFieldNotEditableInCurrentStateError(
        "solicitud.vendedorSolicitud",
      );
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
      delete patch.solicitud.vendedorSolicitud;

      if (input.solicitud.fechaPrimerVencimiento !== undefined) {
        patch.solicitud.fechaPrimerVencimiento =
          input.solicitud.fechaPrimerVencimiento;
      }
    }
    const vendedorLegacyUser = await this.repository.findVendedorLegacyUser?.(
      solicitud.id,
    );
    if (!vendedorLegacyUser)
      throw new LineaPrestamoNoDisponibleParaSolicitudError();
    const lineaOid =
      input.solicitud?.lineaPrestamoLegacyOid ??
      solicitud.lineaPrestamoLegacyOid;
    const lineaPrestamo =
      await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
        vendedorLegacyUser,
        lineaOid,
      );
    if (!lineaPrestamo || !lineaPrestamo.vigente)
      throw new LineaPrestamoNoDisponibleParaSolicitudError();
    const efectivos = ajustarMaximosLinea(lineaPrestamo, {
      cuotas:
        input.solicitud?.cuotas !== undefined
          ? input.solicitud.cuotas
          : solicitud.cuotas,
      montoAFinanciar:
        input.solicitud?.montoAFinanciar !== undefined
          ? input.solicitud.montoAFinanciar
          : solicitud.montoAFinanciar,
    });
    if (lineaOid !== solicitud.lineaPrestamoLegacyOid)
      assertSolicitudDentroDeLimitesDeLinea(lineaPrestamo, efectivos);
    const editaRiesgo = workflowOwnerCode === "RIESGO";
    if (
      input.solicitud?.montoAFinanciar !== undefined &&
      !input.currentUser.isSystemAdmin &&
      !input.currentUser.isAnalista &&
      !editaRiesgo
    )
      assertMontoDentroDelAprobadoPorRiesgo(solicitud, efectivos.montoAFinanciar);
    if (
      efectivos.cuotas !== solicitud.cuotas ||
      efectivos.montoAFinanciar !== solicitud.montoAFinanciar ||
      lineaOid !== solicitud.lineaPrestamoLegacyOid
    ) {
      patch.solicitud ??= {};
      Object.assign(patch.solicitud, efectivos, {
        lineaPrestamoLegacyOid: lineaOid,
        lineaPrestamoDescripcion: lineaPrestamo.descripcion,
      });
    } else if (patch.solicitud) {
      if (patch.solicitud.cuotas !== undefined)
        patch.solicitud.cuotas = efectivos.cuotas;
      if (patch.solicitud.montoAFinanciar !== undefined)
        patch.solicitud.montoAFinanciar = efectivos.montoAFinanciar;
    }

    // Si Riesgo corrige el monto mientras la solicitud esta con el vendedor,
    // ese pasa a ser el nuevo aprobado.
    if (
      editaRiesgo &&
      input.solicitud?.montoAFinanciar !== undefined &&
      ESTADOS_CON_TOPE_DE_RIESGO.includes(solicitud.estadoActual.code)
    ) {
      patch.solicitud ??= {};
      patch.solicitud.montoAprobadoRiesgo = efectivos.montoAFinanciar;
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
    solicitud: {
      cuotas: number | null;
      fechaPrimerVencimiento?: string | null;
      lineaPrestamoLegacyOid: string;
      montoAFinanciar: number | null;
    },
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

    cambios.cuotaResultante = simulacion?.cuotaResultante ?? null;
    if (!simulacion) return;

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
  const minMonto = linea.montoMinimo ?? null;

  if (cuotas !== null && minCuotas !== null && cuotas < minCuotas) {
    throw new SolicitudFueraDeLimitesDeLineaError(
      `La línea requiere al menos ${minCuotas} cuotas.`,
    );
  }

  if (montoAFinanciar !== null && minMonto && montoAFinanciar < minMonto) {
    throw new SolicitudFueraDeLimitesDeLineaError(
      `La línea requiere financiar al menos ${formatMonto(minMonto)}.`,
    );
  }
}

/**
 * Cuando Riesgo devuelve la solicitud, el vendedor puede bajar el monto (y
 * volver a subirlo) pero nunca pasar del que aprobo Riesgo. Riesgo, analistas
 * y administradores no tienen tope.
 */
function assertMontoDentroDelAprobadoPorRiesgo(
  solicitud: { estadoActual: { code: string }; montoAprobadoRiesgo?: number | null },
  montoAFinanciar: number | null,
) {
  const tope = solicitud.montoAprobadoRiesgo ?? null;
  if (!ESTADOS_CON_TOPE_DE_RIESGO.includes(solicitud.estadoActual.code) || tope === null)
    return;

  if (montoAFinanciar === null) {
    throw new MontoSuperaAprobadoRiesgoError(
      `Ingresá un monto de hasta ${formatMonto(tope)}, el aprobado por Riesgo.`,
    );
  }

  if (montoAFinanciar > tope) {
    throw new MontoSuperaAprobadoRiesgoError(
      `El monto máximo es el devuelto por Riesgo: ${formatMonto(tope)}.`,
    );
  }
}

function formatMonto(value: number) {
  return `$${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
