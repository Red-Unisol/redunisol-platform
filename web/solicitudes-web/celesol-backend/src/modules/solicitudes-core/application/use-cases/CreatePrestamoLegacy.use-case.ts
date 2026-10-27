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
} from "../../domain/solicitudes-core-errors";
import type { CreatePrestamoLegacyInput } from "../dtos/CreatePrestamoLegacy.dto";
import { buildLinkFirmaDigital } from "../services/buildLinkFirmaDigital";
import { EnsureSolicitudTitularHasRequiredDataForConfirmar } from "../services/EnsureSolicitudTitularHasRequiredDataForConfirmar";
import { FindSolicitudTitularSocio } from "../services/FindSolicitudTitularSocio";
import type { CrearPrestamoGateway } from "../../infrastructure/services/CrearPrestamoGateway";
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

  constructor(dependencies: Dependencies) {
    this.archivarEvaluacion = dependencies.archivarEvaluacion;
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.simularCuotaSolicitud = dependencies.simularCuotaSolicitud;
    this.authRepository = dependencies.authRepository;
    this.cancelacionesRepository = dependencies.cancelacionesRepository;
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
      return current;
    }
    const prepared = await this.prepare(input);
    if (this.initialGeneration) return this.initialGeneration.create(prepared, input);
    const result = await this.gateway.crear(prepared.coreInput);
    return this.repository.update(input.solicitudId, { solicitud: {
      legacyOid: result.id, lineaPrestamoCodigoMutual: prepared.codigoMutual,
      linkFirmaDigital: buildLinkFirmaDigital(this.linkFirmaDigitalBaseUrl, result.id, prepared.codigoMutual),
    } });
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
    return { solicitud: huboAjuste ? (await this.repository.findById(input.solicitudId)) ?? solicitud : solicitud, codigoMutual: lineaPrestamo.codigoMutual,
      coreInput: {
        cuotas: efectivos.cuotas as number, fechaEmision: this.today(),
        integrantes: [{ socio: socio.nroSocioLegacy, tipoRelacion: "Titular" as const }],
        lineaPrestamo: lineaPrestamo.id, montoDeseado: efectivos.montoAFinanciar as number,
        ...nroLote, vendedor: String(vendedorLegacyId),
      },
    };
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
