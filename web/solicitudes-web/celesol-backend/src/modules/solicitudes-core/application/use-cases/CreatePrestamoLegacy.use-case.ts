import { randomUUID } from "node:crypto";
import { actingContext } from "../../../auth/impersonation/context";
import type { LoanDiagnosticContext, LoanDiagnosticWriter } from "../../../technical-diagnostics/LoanDiagnostics";
import { AdministrativeCorrectionError } from "../../domain/workflow/AdministrativeCorrection";
import { assertLinkedLoanReady, type LinkedLoanReader } from "../services/LinkedLoanRules";
import type { InitialLoanGenerationService } from "../../infrastructure/services/InitialLoanGenerationService";
import type { ArchivarEvaluacionExcel } from "../../../riesgo/application/services/ArchivarEvaluacionExcel";
import { ajustarMaximosLinea } from "../services/AjustarMaximosLinea";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";
import type { SimularCuotaSolicitud } from "../services/SimularCuotaSolicitud";
import {
  LegacyLineaPrestamoUnavailableError,
  InvalidSolicitudesCoreRequestError,
  ConvenioSocioConflictError,
} from "../../domain/solicitudes-core-errors";
import type { CreatePrestamoLegacyInput } from "../dtos/CreatePrestamoLegacy.dto";
import { buildLinkFirmaDigital } from "../services/buildLinkFirmaDigital";
import { EnsureSolicitudTitularHasRequiredDataForConfirmar } from "../services/EnsureSolicitudTitularHasRequiredDataForConfirmar";
import { FindSolicitudTitularSocio } from "../services/FindSolicitudTitularSocio";
import type { CrearPrestamoGateway } from "../../infrastructure/services/CrearPrestamoGateway";
import type { EditarSocioMutualGateway } from "../../infrastructure/services/EditarSocioMutualGateway";
import type {
  ConvenioSocioEdicion,
  ConvenioSocioGateway,
} from "../../domain/services/ConvenioSocioGateway";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudCancelacionRepository } from "../../cancelaciones/domain/repositories/SolicitudCancelacionRepository";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCancelacionesFueraDeRangoError,
  SolicitudCoreNotFoundError,
  SolicitudLegacyOidAlreadyExistsError,
  SolicitudLineaPrestamoLegacyIdUnresolvedError,
  SolicitudPrestamoDataIncompleteError,
  SolicitudTitularSocioLegacyRequiredError,
  SolicitudTitularSocioRequiredForWorkflowError,
  SolicitudVendedorLegacyRequiredError,
} from "../../domain/solicitudes-core-errors";
import type { LineaPrestamoLegacyIdResolver } from "../../domain/services/LineaPrestamoLegacyIdResolver";
import type { AuthRepository } from "../../../auth/domain/repositories/AuthRepository";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";

// NroLote es Int32 en el legado: 2.147.483.647 centavos.
const MAX_CANCELACIONES_CENTAVOS = 2147483647;

type Dependencies = {
  archivarEvaluacion?: Pick<ArchivarEvaluacionExcel, "execute">;
  lineasPrestamoCatalog: LineasPrestamoCatalog;
  simularCuotaSolicitud: Pick<SimularCuotaSolicitud, "execute">;
  authRepository: Pick<AuthRepository, "findById">;
  cancelacionesRepository: Pick<
    SolicitudCancelacionRepository,
    "listBySolicitudId"
  >;
  // Para escribir en Vimarx los datos del convenio editados en el modal.
  convenioSocioGateway?: ConvenioSocioGateway;
  editarSocioGateway?: Pick<EditarSocioMutualGateway, "editar">;
  gateway: CrearPrestamoGateway;
  lineaPrestamoLegacyIdResolver: LineaPrestamoLegacyIdResolver;
  linkFirmaDigitalBaseUrl: string;
  repository: SolicitudesCoreRepository;
  sociosRepository: SocioRepository;
  solicitudesLegacyGateway: Pick<
    SolicitudesLegacyGateway,
    "getVendedorLegacyId"
  >;
  today: () => string;
  linkedLoanReader?: LinkedLoanReader;
  initialGeneration?: Pick<InitialLoanGenerationService, "create">;
  replaceCancelledLoan?: (input: CreatePrestamoLegacyInput, solicitud: SolicitudCore) => Promise<SolicitudCore>;
  diagnostics?: LoanDiagnosticWriter;
};

export class CreatePrestamoLegacyUseCase {
  private readonly archivarEvaluacion?: Pick<ArchivarEvaluacionExcel, "execute">;
  private readonly lineasPrestamoCatalog: LineasPrestamoCatalog;
  private readonly simularCuotaSolicitud: Pick<
    SimularCuotaSolicitud,
    "execute"
  >;
  private readonly authRepository: Pick<AuthRepository, "findById">;
  private readonly cancelacionesRepository: Pick<
    SolicitudCancelacionRepository,
    "listBySolicitudId"
  >;
  private readonly convenioSocioGateway?: ConvenioSocioGateway;
  private readonly editarSocioGateway?: Pick<EditarSocioMutualGateway, "editar">;
  private readonly ensureSolicitudTitularHasRequiredDataForConfirmar: EnsureSolicitudTitularHasRequiredDataForConfirmar;
  private readonly findSolicitudTitularSocio: FindSolicitudTitularSocio;
  private readonly gateway: CrearPrestamoGateway;
  private readonly lineaPrestamoLegacyIdResolver: LineaPrestamoLegacyIdResolver;
  private readonly linkFirmaDigitalBaseUrl: string;
  private readonly repository: SolicitudesCoreRepository;
  private readonly solicitudesLegacyGateway: Pick<
    SolicitudesLegacyGateway,
    "getVendedorLegacyId"
  >;
  private readonly today: () => string;
  private readonly linkedLoanReader?: LinkedLoanReader;
  private readonly initialGeneration?: Pick<InitialLoanGenerationService, "create">;
  private readonly replaceCancelledLoan?: Dependencies["replaceCancelledLoan"];
  private readonly diagnostics?: LoanDiagnosticWriter;

  constructor(dependencies: Dependencies) {
    this.archivarEvaluacion = dependencies.archivarEvaluacion;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.simularCuotaSolicitud = dependencies.simularCuotaSolicitud;
    this.authRepository = dependencies.authRepository;
    this.cancelacionesRepository = dependencies.cancelacionesRepository;
    this.convenioSocioGateway = dependencies.convenioSocioGateway;
    this.editarSocioGateway = dependencies.editarSocioGateway;
    this.ensureSolicitudTitularHasRequiredDataForConfirmar =
      new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: dependencies.repository,
      });
    this.findSolicitudTitularSocio = new FindSolicitudTitularSocio({
      sociosRepository: dependencies.sociosRepository,
    });
    this.gateway = dependencies.gateway;
    this.lineaPrestamoLegacyIdResolver =
      dependencies.lineaPrestamoLegacyIdResolver;
    this.linkFirmaDigitalBaseUrl = dependencies.linkFirmaDigitalBaseUrl;
    this.repository = dependencies.repository;
    this.solicitudesLegacyGateway = dependencies.solicitudesLegacyGateway;
    this.today = dependencies.today;
    this.linkedLoanReader = dependencies.linkedLoanReader;
    this.initialGeneration = dependencies.initialGeneration;
    this.replaceCancelledLoan = dependencies.replaceCancelledLoan;
    this.diagnostics = dependencies.diagnostics;
  }

  private async diagnostic(context: LoanDiagnosticContext, stage: string, data: unknown) {
    try { await this.diagnostics?.(context, { stage, data }); } catch { /* Diagnostics must not change the loan result. */ }
  }

  async execute(input: CreatePrestamoLegacyInput): Promise<SolicitudCore> {
    const current = await this.repository.findById(input.solicitudId);
    if (!current) throw new SolicitudCoreNotFoundError();
    this.assertCanGenerate(current, input);
    if (current.legacyOid) {
      if (!this.linkedLoanReader) throw new SolicitudLegacyOidAlreadyExistsError();
      const loan = await this.linkedLoanReader(current);
      if (loan.status === "cancelled" && this.replaceCancelledLoan)
        return this.replaceCancelledLoan(input, current);
      assertLinkedLoanReady(loan);
      if (input.convenio && Object.keys(input.convenio).length > 0)
        throw new InvalidSolicitudesCoreRequestError("El préstamo ya está generado. Los datos del convenio deben editarse en Vimarx.");
      return current;
    }
    const prepared = await this.prepare(input);
    if (this.initialGeneration) return this.initialGeneration.create(prepared, input);
    const context: LoanDiagnosticContext = {
      operationId: randomUUID(), solicitudId: input.solicitudId, actorId: input.currentUser.id,
      realActorId: actingContext.getStore()?.administrator.id ?? input.currentUser.id, operation: "loan_generation",
    };
    let newLoanId: string;
    try { newLoanId = (await this.gateway.crear(prepared.coreInput, context)).id; }
    catch (error) {
      await this.diagnostic(context, "ERROR", { phase: "REMOTE_CREATION", error });
      throw error;
    }
    await this.diagnostic(context, "CREATED_REMOTE", { newLoanId });
    try {
      const linked = await this.repository.update(input.solicitudId, { solicitud: {
        legacyOid: newLoanId, lineaPrestamoCodigoMutual: prepared.codigoMutual,
        linkFirmaDigital: buildLinkFirmaDigital(this.linkFirmaDigitalBaseUrl, newLoanId, prepared.codigoMutual),
      } });
      await this.diagnostic(context, "LINKED", { newLoanId });
      return linked;
    } catch (error) {
      await this.diagnostic(context, "LINK_FAILED", { newLoanId, error });
      throw error;
    }
  }

  async prepareReplacement(input: CreatePrestamoLegacyInput) {
    return this.prepare(input, true);
  }

  private assertCanGenerate(solicitud: SolicitudCore, input: CreatePrestamoLegacyInput) {
    if (!input.currentUser.isSystemAdmin &&
      (!solicitud.estadoActual.ownerId || solicitud.estadoActual.ownerId !== input.currentUser.workflowOwnerId))
      throw new ForbiddenSolicitudAccessError();
    if (solicitud.estadoActual.code !== "Confirmada")
      throw new AdministrativeCorrectionError("El préstamo se genera o regenera desde Confirmada. Primero completá la revisión y confirmá la solicitud.");
  }

  private async prepare(input: CreatePrestamoLegacyInput, replacement = false) {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }
    this.assertCanGenerate(solicitud, input);

    if (solicitud.legacyOid && !replacement) {
      throw new SolicitudLegacyOidAlreadyExistsError();
    }

    if (!input.currentUser.isSystemAdmin) {
      const ownerId = solicitud.estadoActual.ownerId ?? null;

      if (!ownerId || ownerId !== input.currentUser.workflowOwnerId) {
        throw new ForbiddenSolicitudAccessError();
      }
    }

    const missingFieldLabels: string[] = [];

    if (solicitud.montoAFinanciar === null) {
      missingFieldLabels.push("Monto a financiar");
    }

    if (solicitud.cuotas === null) {
      missingFieldLabels.push("Cuotas");
    }

    if (missingFieldLabels.length > 0) {
      throw new SolicitudPrestamoDataIncompleteError(missingFieldLabels);
    }

    // El prestamo se genera en Confirmada, y para confirmar ya se exigen estos
    // datos del titular. Pero el boton depende del dueño del estado actual, no
    // del estado, asi que Riesgo puede generarlo apenas le llega la solicitud
    // -- antes de que se haya pedido nada de esto.
    //
    // En el flujo normal esta validacion no cambia nada: la solicitud ya paso
    // por la misma al confirmar. Solo frena el atajo, que dejaba prestamos
    // reales en Vimarx para solicitudes que despues no se pueden confirmar.
    await this.ensureSolicitudTitularHasRequiredDataForConfirmar.execute(
      input.solicitudId,
    );

    const socio = await this.findSolicitudTitularSocio.execute(
      solicitud.titular,
    );

    if (!socio) {
      throw new SolicitudTitularSocioRequiredForWorkflowError();
    }

    if (!socio.nroSocioLegacy) {
      throw new SolicitudTitularSocioLegacyRequiredError();
    }

    const creator = await this.authRepository.findById(solicitud.createdBy);

    if (!creator) {
      throw new SolicitudVendedorLegacyRequiredError();
    }

    const vendedorLegacyId =
      await this.solicitudesLegacyGateway.getVendedorLegacyId(
        creator.legacyUser,
      );

    if (vendedorLegacyId === null) {
      throw new SolicitudVendedorLegacyRequiredError();
    }

    // La solicitud guarda el Oid de la linea tal como se la ofrecimos al
    // vendedor, que pertenece a otra tabla del legado y casi nunca coincide con
    // el ID que espera CrearPrestamo. Se traduce aca, en el ultimo momento, y
    // no al guardar la solicitud: el Oid guardado es el que se usa para
    // reencontrar la linea en la lista del vendedor al editarla.
    const lineaPrestamo =
      await this.lineaPrestamoLegacyIdResolver.resolveByPresolicitudOid(
        solicitud.lineaPrestamoLegacyOid,
      );

    if (lineaPrestamo === null) {
      throw new SolicitudLineaPrestamoLegacyIdUnresolvedError(
        solicitud.lineaPrestamoDescripcion,
      );
    }

    const vendedorLegacyUser = await this.repository.findVendedorLegacyUser?.(
      solicitud.id,
    );
    if (!vendedorLegacyUser) throw new LegacyLineaPrestamoUnavailableError();
    const limitesLinea =
      await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
        vendedorLegacyUser,
        solicitud.lineaPrestamoLegacyOid,
      );
    if (!limitesLinea || !limitesLinea.vigente)
      throw new LegacyLineaPrestamoUnavailableError();
    const efectivos = ajustarMaximosLinea(limitesLinea, solicitud);
    const huboAjuste =
      efectivos.cuotas !== solicitud.cuotas ||
      efectivos.montoAFinanciar !== solicitud.montoAFinanciar;
    if (replacement && huboAjuste)
      throw new AdministrativeCorrectionError("La línea exige ajustar el monto o las cuotas. Guardá las condiciones corregidas antes de reemplazar.");
    if (huboAjuste) {
      const calculo = await this.simularCuotaSolicitud.execute({
        ...efectivos,
        lineaPrestamoLegacyOid: solicitud.lineaPrestamoLegacyOid,
        fechaPrimerVencimiento: solicitud.fechaPrimerVencimiento ?? null,
      });
      await this.repository.update(input.solicitudId, {
        solicitud: {
          ...efectivos,
          cuotaResultante: calculo?.cuotaResultante ?? null,
        },
      });
    }
    const nroLote = await this.buildNroLoteCancelaciones(input.solicitudId,
      replacement || huboAjuste ? (efectivos.montoAFinanciar as number) : undefined);
    await this.archivarEvaluacion?.execute({solicitudId: input.solicitudId, actorId: input.currentUser.id, etapa: "generacion"});
    // Validar las condiciones antes de escribir en el socio. Un conflicto o
    // rechazo del convenio detiene la generacion antes de CrearPrestamo.
    await this.actualizarConvenioSocio(socio.nroSocioLegacy, input.convenio);
    return { solicitud: huboAjuste ? (await this.repository.findById(input.solicitudId)) ?? solicitud : solicitud, codigoMutual: lineaPrestamo.codigoMutual,
      coreInput: {
        cuotas: efectivos.cuotas as number, fechaEmision: this.today(),
        integrantes: [{ socio: socio.nroSocioLegacy, tipoRelacion: "Titular" as const }],
        lineaPrestamo: lineaPrestamo.id, montoDeseado: efectivos.montoAFinanciar as number,
        ...nroLote, vendedor: String(vendedorLegacyId),
      },
    };
  }

  // Compara solo los campos editados contra su valor original. La lectura y
  // escritura remotas son llamadas separadas: detecta conflictos previos al
  // envio, sin constituir una transaccion con la escritura remota.
  private async actualizarConvenioSocio(
    socioLegacyId: string,
    convenio: ConvenioSocioEdicion | undefined,
  ) {
    if (!convenio || Object.keys(convenio).length === 0) return;

    if (!this.convenioSocioGateway || !this.editarSocioGateway) {
      throw new Error("Falta configurar la edicion del convenio del socio.");
    }

    const actual =
      await this.convenioSocioGateway.getConvenioSocioByLegacyId(socioLegacyId);

    if (!actual) {
      throw new InvalidSolicitudesCoreRequestError(
        "No se pudieron leer los datos del convenio del socio en Vimarx.",
      );
    }

    const campos: Record<string, string> = {};
    const conflictos: string[] = [];
    const textos = [
      ["beneficio", "SocAux.Beneficio", "Mudon (beneficio)"],
      ["observaciones", "Observaciones", "Observaciones"],
    ] as const;
    const numeros = [
      ["caja40", "SocAux.Caja40", "Caja 40"],
      ["convAux", "SocAux.ConvAux", "AMEJUCA"],
    ] as const;

    for (const [key, campo, label] of textos) {
      const cambio = convenio[key];
      if (!cambio) continue;
      const nuevo = cambio.valor?.trim() || null;
      const original = cambio.original?.trim() || null;
      // Revertir un cambio en el modal no autoriza a escribir el campo.
      if (nuevo === original || nuevo === actual[key]) continue;
      if (original !== actual[key]) conflictos.push(label);
      else campos[campo] = nuevo ?? "";
    }

    for (const [key, campo, label] of numeros) {
      const cambio = convenio[key];
      if (!cambio) continue;
      const nuevo = cambio.valor;
      if (nuevo === cambio.original || nuevo === actual[key]) continue;
      if (cambio.original !== actual[key]) {
        conflictos.push(label);
        continue;
      }

      // Vacio en un numero de SocAux Vimarx lo guarda como 0, no como vacio.
      if (nuevo === null) {
        if (actual[key] === 0) continue;

        throw new InvalidSolicitudesCoreRequestError(
          `${label} no se puede borrar: Vimarx lo guardaría en 0. Cargá el valor que corresponde.`,
        );
      }

      campos[campo] = String(nuevo);
    }

    if (conflictos.length > 0) throw new ConvenioSocioConflictError(conflictos);
    if (Object.keys(campos).length === 0) return;

    await this.editarSocioGateway.editar(socioLegacyId, campos);
  }

  // El legado no recibe las cancelaciones: las lee de la solicitud antigua, que
  // un prestamo creado por API no tiene. Viajan en NroLote, en centavos porque
  // el campo es entero, y la novedad CAN3RO de la linea las convierte en el
  // movimiento que el asiento contabiliza como "Cancela 3eros". Una linea sin
  // esa novedad configurada ignora el numero: no rompe nada.
  private async buildNroLoteCancelaciones(
    solicitudId: string,
    montoAFinanciar?: number,
  ): Promise<{ nroLote?: number }> {
    const cancelaciones =
      await this.cancelacionesRepository.listBySolicitudId(solicitudId);
    const total = cancelaciones
      .filter((cancelacion) => cancelacion.deletedAt === null)
      .reduce((suma, cancelacion) => suma + cancelacion.monto, 0);

    if (montoAFinanciar !== undefined && total > montoAFinanciar)
      throw new InvalidSolicitudesCoreRequestError(
        "Las cancelaciones superan el monto a desembolsar.",
      );
    if (total <= 0) {
      return {};
    }

    const centavos = Math.round(total * 100);

    // Sin este corte el legado guardaria un numero truncado y el asiento
    // dividiria por un monto que nadie cargo.
    if (centavos > MAX_CANCELACIONES_CENTAVOS) {
      throw new SolicitudCancelacionesFueraDeRangoError(
        MAX_CANCELACIONES_CENTAVOS / 100,
      );
    }

    return { nroLote: centavos };
  }
}
