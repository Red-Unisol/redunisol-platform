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
  solicitudesLegacyGateway: Pick<SolicitudesLegacyGateway, "getVendedorLegacyId">;
  today: () => string;
};

export class CreatePrestamoLegacyUseCase {
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

  constructor(dependencies: Dependencies) {
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
  }

  async execute(input: CreatePrestamoLegacyInput): Promise<SolicitudCore> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    if (solicitud.legacyOid) {
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

    const vendedorLegacyId = await this.solicitudesLegacyGateway.getVendedorLegacyId(
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

    const result = await this.gateway.crear({
      cuotas: solicitud.cuotas as number,
      fechaEmision: this.today(),
      integrantes: [{ socio: socio.nroSocioLegacy, tipoRelacion: "Titular" }],
      lineaPrestamo: lineaPrestamo.id,
      montoDeseado: solicitud.montoAFinanciar as number,
      ...(await this.buildNroLoteCancelaciones(input.solicitudId)),
      vendedor: String(vendedorLegacyId),
    });

    const linkFirmaDigital = buildLinkFirmaDigital(
      this.linkFirmaDigitalBaseUrl,
      result.id,
      lineaPrestamo.codigoMutual,
    );

    return this.repository.update(input.solicitudId, {
      solicitud: {
        legacyOid: result.id,
        // Se guarda ademas de usarse en el link: el finalizar lo necesita
        // para elegir el documento sin depender del parametro de la URL.
        lineaPrestamoCodigoMutual: lineaPrestamo.codigoMutual,
        linkFirmaDigital,
      },
    });
  }

  // El legado no recibe las cancelaciones: las lee de la solicitud antigua, que
  // un prestamo creado por API no tiene. Viajan en NroLote, en centavos porque
  // el campo es entero, y la novedad CAN3RO de la linea las convierte en el
  // movimiento que el asiento contabiliza como "Cancela 3eros". Una linea sin
  // esa novedad configurada ignora el numero: no rompe nada.
  private async buildNroLoteCancelaciones(
    solicitudId: string,
  ): Promise<{ nroLote?: number }> {
    const cancelaciones =
      await this.cancelacionesRepository.listBySolicitudId(solicitudId);
    const total = cancelaciones
      .filter((cancelacion) => cancelacion.deletedAt === null)
      .reduce((suma, cancelacion) => suma + cancelacion.monto, 0);

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
