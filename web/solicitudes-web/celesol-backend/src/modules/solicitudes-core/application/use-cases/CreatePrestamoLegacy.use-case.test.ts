import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthRepository } from "../../../auth/domain/repositories/AuthRepository";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { CrearPrestamoGateway } from "../../infrastructure/services/CrearPrestamoGateway";
import type { Socio } from "../../../socios/domain/entities/Socio.entity";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudCancelacion } from "../../cancelaciones/domain/entities/SolicitudCancelacion.entity";
import type { SolicitudCancelacionRepository } from "../../cancelaciones/domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type {
  LineaPrestamoLegacy,
  LineaPrestamoLegacyIdResolver,
} from "../../domain/services/LineaPrestamoLegacyIdResolver";
import {
  ForbiddenSolicitudAccessError,
  ConvenioSocioConflictError,
  SolicitudCancelacionesFueraDeRangoError,
  SolicitudCoreNotFoundError,
  SolicitudLegacyOidAlreadyExistsError,
  SolicitudLineaPrestamoLegacyIdUnresolvedError,
  SolicitudPrestamoDataIncompleteError,
  SolicitudTitularSocioLegacyRequiredError,
  SolicitudTitularSocioRequiredForWorkflowError,
  SolicitudVendedorLegacyRequiredError,
} from "../../domain/solicitudes-core-errors";
import { CreatePrestamoLegacyUseCase } from "./CreatePrestamoLegacy.use-case";

const LINK_FIRMA_BASE_URL = "https://redunisol.com.ar/finalizar.php";
const TODAY = "2026-07-22";

describe("CreatePrestamoLegacyUseCase", () => {
  it("builds the payload from the solicitud and titular socio, calls the gateway, and persists legacyOid", async () => {
    let receivedInput: unknown;
    let archiveFailed = false;
    const archives: unknown[] = [];

    const gateway = fakeGateway({
      crear: async (input: unknown) => {
        assert.equal(archives.length, 1);
        receivedInput = input;
        return { id: "555000" };
      },
    });
    let receivedUpdate: { id: string; patch: unknown } | undefined;
    const repository = solicitudesRepository({
      update: async (id, patch) => {
        receivedUpdate = { id, patch };
        return solicitud({ legacyOid: "555000" });
      },
    });
    const useCase = new CreatePrestamoLegacyUseCase({
      archivarEvaluacion: { execute: async input => { if(archiveFailed) throw new Error("archivo falló"); archives.push(input); } },
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway,
      repository,
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    const result = await useCase.execute({
      currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
      solicitudId: "sol-1",
    });

    assert.equal(result.legacyOid, "555000");
    assert.deepEqual(archives, [{solicitudId:"sol-1",actorId:"user-1",etapa:"generacion"}]);


    assert.deepEqual(receivedInput, {
      cuotas: 6,
      fechaEmision: TODAY,
      integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
      lineaPrestamo: "LP-REAL-1",
      montoDeseado: 10000,
      vendedor: "347",
    });
    assert.deepEqual(receivedUpdate, {
      id: "sol-1",
      patch: {
        solicitud: {
          legacyOid: "555000",
          // Se persiste ademas de viajar en el link: es lo que despues usa el
          // finalizar para elegir el documento sin mirar la URL.
          lineaPrestamoCodigoMutual: "amejuca",
          linkFirmaDigital:
            "https://redunisol.com.ar/finalizar.php?linea=amejuca&ntrans=0&sol=555000",
        },
      },
    });
    archiveFailed = true;
    receivedInput = undefined;
    await assert.rejects(() => useCase.execute({currentUser:{id:"user-1",workflowOwnerId:"owner-2"},solicitudId:"sol-1"}), /archivo falló/);
    assert.equal(receivedInput, undefined);
  });

  it("sends the live cancelaciones total as NroLote in cents and skips the deleted ones", async () => {
    let receivedInput: { nroLote?: number } | undefined;
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository([
        cancelacion({ id: "canc-1", monto: 30000 }),
        cancelacion({ id: "canc-2", monto: 630378.35 }),
        cancelacion({
          id: "canc-3",
          monto: 1000,
          deletedAt: new Date("2026-07-22T11:00:00.000Z"),
        }),
      ]),
      gateway: fakeGateway({
        crear: async (input: unknown) => {
          receivedInput = input as { nroLote?: number };
          return { id: "555000" };
        },
      }),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await useCase.execute({
      currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
      solicitudId: "sol-1",
    });

    assert.equal(receivedInput?.nroLote, 66037835);
  });

  it("omits NroLote when the solicitud has no cancelaciones", async () => {
    let receivedInput: { nroLote?: number } | undefined;
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway({
        crear: async (input: unknown) => {
          receivedInput = input as { nroLote?: number };
          return { id: "555000" };
        },
      }),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await useCase.execute({
      currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
      solicitudId: "sol-1",
    });

    assert.ok(receivedInput);
    assert.ok(!("nroLote" in receivedInput));
  });

  it("rejects cancelaciones above what the legacy integer field holds, without creating the prestamo", async () => {
    let called = false;
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository([
        cancelacion({ monto: 21474836.48 }),
      ]),
      gateway: fakeGateway({
        crear: async () => {
          called = true;
          return { id: "555000" };
        },
      }),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudCancelacionesFueraDeRangoError,
    );
    assert.equal(called, false);
  });

  it("allows a system admin regardless of ownerId", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.doesNotReject(() =>
      useCase.execute({
        currentUser: {
          id: "admin-1",
          isSystemAdmin: true,
          workflowOwnerId: "some-other-owner",
        },
        solicitudId: "sol-1",
      }),
    );
  });

  it("throws SolicitudCoreNotFoundError when the solicitud does not exist", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository({ findById: async () => null }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "missing",
        }),
      SolicitudCoreNotFoundError,
    );
  });

  it("throws SolicitudLegacyOidAlreadyExistsError when legacyOid is already set", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository({
        findById: async () => solicitud({ legacyOid: "111" }),
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudLegacyOidAlreadyExistsError,
    );
  });

  it("throws ForbiddenSolicitudAccessError when the current user is not the solicitud owner", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "some-other-owner" },
          solicitudId: "sol-1",
        }),
      ForbiddenSolicitudAccessError,
    );
  });

  it("throws SolicitudPrestamoDataIncompleteError listing missing fields when montoAFinanciar and cuotas are null", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository({
        findById: async () => solicitud({ cuotas: null, montoAFinanciar: null }),
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof SolicitudPrestamoDataIncompleteError);
        assert.deepEqual(error.missingFieldLabels, [
          "Monto a financiar",
          "Cuotas",
        ]);
        return true;
      },
    );
  });

  it("does not create the prestamo when the titular is missing data required to confirm", async () => {
    // El boton depende del dueño del estado actual, no del estado, asi que
    // Riesgo puede generar el prestamo apenas le llega la solicitud -- antes de
    // que se haya exigido nada del titular. Sin esta validacion quedaban
    // prestamos reales en Vimarx para solicitudes que despues no se podian
    // confirmar.
    let crearCalled = false;
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway({
        crear: async () => {
          crearCalled = true;
          return { id: "555000" };
        },
      }),
      repository: solicitudesRepository({
        findById: async () =>
          solicitud({
            titular: { ...solicitud().titular, cbu: null },
          }),
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { name?: string }).name,
          "SolicitudTitularDataIncompleteForConfirmarError",
        );
        return true;
      },
    );
    assert.equal(crearCalled, false);
  });

  it("throws SolicitudTitularSocioRequiredForWorkflowError when no socio matches the titular", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudTitularSocioRequiredForWorkflowError,
    );
  });

  it("throws SolicitudTitularSocioLegacyRequiredError when the socio has no nroSocioLegacy", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository({
        lookupByDocumento: async () => [buildSocio({ nroSocioLegacy: null })],
      }),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudTitularSocioLegacyRequiredError,
    );
  });

  it("does not persist anything when the gateway rejects the creation", async () => {
    let updateCalled = false;
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway({
        crear: async () => {
          throw new Error("legacy rejected");
        },
      }),
      repository: solicitudesRepository({
        update: async () => {
          updateCalled = true;
          throw new Error("should not be called");
        },
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      /legacy rejected/,
    );
    assert.equal(updateCalled, false);
  });

  it("throws SolicitudVendedorLegacyRequiredError when the creator user is not found", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository({ findById: async () => null }),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudVendedorLegacyRequiredError,
    );
  });

  it("throws SolicitudVendedorLegacyRequiredError when the creator has no legacy user id", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway({
        getVendedorLegacyId: async () => null,
      }),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudVendedorLegacyRequiredError,
    );
  });

  it("does not call the gateway when the linea cannot be resolved in the legacy system", async () => {
    let crearCalled = false;
    const gateway = fakeGateway({
      crear: async () => {
        crearCalled = true;
        return { id: "555000" };
      },
    });
    const useCase = new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      gateway,
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(null),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudLineaPrestamoLegacyIdUnresolvedError,
    );
    // Lo importante no es solo que falle, sino que NO llegue a crear nada: un
    // prestamo con la linea equivocada no da error y queda mal en silencio.
    assert.equal(crearCalled, false);
  });
});

function fakeGateway(
  impl: Partial<CrearPrestamoGateway> = {},
): CrearPrestamoGateway {
  return {
    crear: async () => ({ id: "999" }),
    ...impl,
  } as unknown as CrearPrestamoGateway;
}

// Devuelve un id distinto del que guarda la solicitud ("LP-1") a proposito: asi
// las aserciones sobre el payload prueban que se manda el id TRADUCIDO y no el
// Oid de presolicitud que quedo guardado. El codigo de mutual tambien difiere
// de la descripcion de la solicitud ("Personal") por la misma razon.
function cancelacionesRepository(
  cancelaciones: SolicitudCancelacion[] = [],
): Pick<SolicitudCancelacionRepository, "listBySolicitudId"> {
  return { listBySolicitudId: async () => cancelaciones };
}

function cancelacion(
  overrides: Partial<SolicitudCancelacion> = {},
): SolicitudCancelacion {
  return {
    id: "canc-1",
    solicitudId: "sol-1",
    cuentaADebitar: "5250 - CENTRO COMERCIAL",
    cbu: "3300500115000142500022",
    cuentaBancaria: "Cuenta habitual",
    socio: "5250 - CENTRO COMERCIAL",
    socioLegacyId: "142758",
    monto: 30000,
    notas: null,
    createdBy: null,
    createdAt: new Date("2026-07-22T10:00:00.000Z"),
    updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function lineaPrestamoResolver(
  resolved: LineaPrestamoLegacy | null = {
    codigoMutual: "amejuca",
    id: "LP-REAL-1",
  },
): LineaPrestamoLegacyIdResolver {
  return {
    resolveByPresolicitudOid: async () => resolved,
  };
}

function authRepository(
  overrides: Partial<Pick<AuthRepository, "findById">> = {},
): Pick<AuthRepository, "findById"> {
  return {
    findById: async () => buildAuthUser(),
    ...overrides,
  };
}

function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    email: "vendedor@example.com",
    emailVerified: true,
    firstName: "Vendedor",
    id: "user-1",
    isSystemAdmin: false,
    lastName: "Uno",
    legacyUser: "VUSER",
    recibeAsignacionAutomatica: false,
    state: 1,
    workflowOwnerId: null,
    ...overrides,
  };
}

function solicitudesLegacyGateway(
  overrides: Partial<
    Pick<SolicitudesLegacyGateway, "getVendedorLegacyId">
  > = {},
): Pick<SolicitudesLegacyGateway, "getVendedorLegacyId"> {
  return {
    getVendedorLegacyId: async () => 347,
    ...overrides,
  };
}

function buildSocio(overrides: Partial<Socio> = {}): Socio {
  return {
    apellido: "Perez",
    celular: null,
    createdAt: new Date("2026-06-19T18:00:00.000Z"),
    cuit: "20333444559",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: null,
    fechaDeNacimiento: new Date("1990-01-01T00:00:00.000Z"),
    id: "socio-1",
    nombre: "Juan",
    nroDocumento: "33344455",
    nroSocioLegacy: "143471",
    razonSocial: null,
    sexo: "M",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA",
    updatedAt: new Date("2026-06-19T18:00:00.000Z"),
    ...overrides,
  } as Socio;
}

function socioRepository(
  overrides: Partial<SocioRepository> = {},
): SocioRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
    findByCuit: async () => null,
    findByDocumento: async () => null,
    findById: async () => null,
    list: async () => [],
    lookupByDocumento: async () => [buildSocio()],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function solicitud(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    id: "sol-1",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: 6,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "Confirmada",
      id: "state-4",
      name: "Confirmada",
      ownerId: "owner-2",
    },
    firmaDigitalmente: false,
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: 10000,
    motivo: null,
    nroSolicitud: null,
    observaciones: null,
    garantias: [],
    conyuge: null,
    datosLaborales: {
      actividadLaboral: null,
      antiguedadLaboralMeses: null,
      descuentosSueldo: null,
      domicilioLaboralCalle: null,
      domicilioLaboralLocalidad: null,
      domicilioLaboralNroPuerta: null,
      domicilioLaboralPisoDepto: null,
      empleador: null,
      fechaIngresoLaboral: null,
      montoRecibo: null,
      relacionLaboral: null,
      tarjetas: null,
      vehiculo: null,
      vivienda: null,
    },
    // Titular completo: generar el prestamo exige los mismos datos que
    // confirmar la solicitud.
    titular: {
      apellidoDenominacion: "Perez",
      cbu: "2850590940090418135201",
      cbuNoHabitual: null,
      celular: "1122334455",
      cuit: "20-33344455-9",
      domicilioCalle: null,
      email: "juan@example.com",
      fechaNacimiento: "1990-05-20",
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33.344.455",
      nroPuerta: null,
      nroSocio: null,
      sexo: "M",
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    vendedorSolicitud: null,
    ...overrides,
  };
}

function solicitudesRepository(
  overrides: Partial<SolicitudesCoreRepository> = {},
): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findVendedorLegacyUser: async () => "VUSER",
    findById: async () => solicitud(),
    listByOwner: async () => [],
    update: async () => solicitud({ legacyOid: "999" }),
    ...overrides,
  };
}

it("rechecks current legacy maxima and persists adjusted values before the existing generation gateway", async () => {
  const events: unknown[] = [];
  const useCase = new CreatePrestamoLegacyUseCase({
    authRepository: authRepository(), cancelacionesRepository: cancelacionesRepository(),
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async (user) => {
      assert.equal(user, "VUSER");
      return { descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 5000, cantidadMaximaCuotas: 3 };
    } },
    simularCuotaSolicitud: { execute: async (input) => { events.push({ calculation: input }); return { cuotaResultante: "2000,00", fechaPrimerVencimiento: "2026-11-30" }; } },
    repository: solicitudesRepository({ update: async (_id, patch) => { events.push({ patch }); return solicitud(); } }),
    gateway: fakeGateway({ crear: async (input) => { events.push({ generation: input }); return { id: "fake-only" }; } }),
    lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(), linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
    sociosRepository: socioRepository(), solicitudesLegacyGateway: solicitudesLegacyGateway(), today: () => TODAY,
  });
  await useCase.execute({ solicitudId: "sol-1", currentUser: { id: "user-1", workflowOwnerId: "owner-2" } });
  assert.equal(events.length, 4);
  const persisted = events[1] as { patch: { solicitud: { montoAFinanciar: number; cuotas: number; cuotaResultante: string } } };
  assert.equal(persisted.patch.solicitud.montoAFinanciar, 5000);
  assert.equal(persisted.patch.solicitud.cuotas, 3);
  assert.equal(persisted.patch.solicitud.cuotaResultante, "2000,00");
  const generated = (events[2] as { generation: { cuotas: number; montoDeseado: number } }).generation;
  assert.equal(generated.cuotas, 3); assert.equal(generated.montoDeseado, 5000);
});

it("replacement preflight retains required data checks and rejects unsaved maxima or excess cancellations without creating", async () => {
  let max = 10000000;
  let total = 0;
  let createCalls = 0;
  let writes = 0;
  const useCase = new CreatePrestamoLegacyUseCase({
    authRepository: authRepository(), cancelacionesRepository: { listBySolicitudId: async () => total ? [cancelacion({ monto: total })] : [] },
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: max, cantidadMaximaCuotas: 48 }) },
    simularCuotaSolicitud: { execute: async () => { throw new Error("must not silently adjust"); } },
    repository: solicitudesRepository({ findById: async () => solicitud({ legacyOid: "443417" }), update: async () => { writes++; return solicitud(); } }),
    gateway: fakeGateway({ crear: async () => { createCalls++; return { id: "999" }; } }),
    lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(), linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
    sociosRepository: socioRepository(), solicitudesLegacyGateway: solicitudesLegacyGateway(), today: () => TODAY,
  });
  const input = { solicitudId: "sol-1", currentUser: { id: "user-1", workflowOwnerId: "owner-2", isSystemAdmin: true } };
  assert.equal((await useCase.prepareReplacement(input)).coreInput.montoDeseado, 10000);
  max = 5000;
  await assert.rejects(() => useCase.prepareReplacement(input), /Guardá las condiciones/);
  max = 10000000; total = 10001;
  await assert.rejects(() => useCase.prepareReplacement(input), /cancelaciones superan/);
  total = 0;
  assert.equal((await useCase.prepareReplacement({ ...input, currentUser: { ...input.currentUser, isSystemAdmin: false } })).coreInput.montoDeseado, 10000);
  await assert.rejects(() => useCase.prepareReplacement({ ...input, currentUser: { ...input.currentUser, isSystemAdmin: false, workflowOwnerId: "otro" } }), ForbiddenSolicitudAccessError);
  assert.equal(createCalls, 0); assert.equal(writes, 0);
});

function buildLinkedUseCase(overrides: Partial<ConstructorParameters<typeof CreatePrestamoLegacyUseCase>[0]> = {}) {
  return new CreatePrestamoLegacyUseCase({
    authRepository: authRepository(), cancelacionesRepository: cancelacionesRepository(),
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
    simularCuotaSolicitud: { execute: async () => null }, repository: solicitudesRepository({ findById: async () => solicitud({ legacyOid: "444" }) }),
    gateway: fakeGateway({ crear: async () => { throw new Error("must not create twice"); } }),
    lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(), linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
    sociosRepository: socioRepository(), solicitudesLegacyGateway: solicitudesLegacyGateway(), today: () => TODAY,
    ...overrides,
  });
}
const linkedInput = { solicitudId: "sol-1", currentUser: { id: "user-1", workflowOwnerId: "owner-2" } };
const linkedStatus = { status: "active" as const, currentLoanId: "444", resolvedLoanId: "444", amount: 10000, requestedAmount: 10000, matchesAmount: true, amountEditable: false };

it("reuses an existing active loan at the same amount without generating again", async () => {
  const uc = buildLinkedUseCase({ linkedLoanReader: async () => linkedStatus });
  assert.equal((await uc.execute(linkedInput)).legacyOid, "444");
});

it("blocks an existing different amount and delegates proven cancellation to controlled replacement", async () => {
  const mismatch = buildLinkedUseCase({ linkedLoanReader: async () => ({ ...linkedStatus, amount: 9000, matchesAmount: false }) });
  await assert.rejects(mismatch.execute(linkedInput), /monto distinto.*444/);
  let replaced = false;
  const cancelled = buildLinkedUseCase({ linkedLoanReader: async () => ({ ...linkedStatus, status: "cancelled", amountEditable: true }),
    replaceCancelledLoan: async () => { replaced = true; return solicitud({ legacyOid: "555" }); } });
  assert.equal((await cancelled.execute(linkedInput)).legacyOid, "555");
  assert.equal(replaced, true);
});

it("generation and regeneration require Confirmada, including for administrators", async () => {
  const uc = buildLinkedUseCase({ repository: solicitudesRepository({ findById: async () => solicitud({ estadoActual: { code: "RevisionRiesgo", name: "Revisión", id: "risk", ownerId: "owner-2" } }) }) });
  await assert.rejects(uc.execute({ ...linkedInput, currentUser: { ...linkedInput.currentUser, isSystemAdmin: true } }), /desde Confirmada/);
});

describe("CreatePrestamoLegacyUseCase convenio del socio", () => {
  const VIMARX = {
    beneficio: "733767/0",
    caja40: 100,
    convAux: null,
    nroSocio: "90999",
    observaciones: null,
  };

  function buildUseCase(calls: string[], ediciones: unknown[], editarError?: Error,
    overrides: Partial<ConstructorParameters<typeof CreatePrestamoLegacyUseCase>[0]> = {}) {
    return new CreatePrestamoLegacyUseCase({
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }) },
      simularCuotaSolicitud: { execute: async () => null },
      linkFirmaDigitalBaseUrl: LINK_FIRMA_BASE_URL,
      lineaPrestamoLegacyIdResolver: lineaPrestamoResolver(),
      authRepository: authRepository(),
      cancelacionesRepository: cancelacionesRepository(),
      convenioSocioGateway: { getConvenioSocioByLegacyId: async () => VIMARX },
      editarSocioGateway: {
        editar: async (socioLegacyId, campos) => {
          calls.push("editar");
          ediciones.push({ socioLegacyId, campos });
          if (editarError) throw editarError;
        },
      },
      gateway: fakeGateway({
        crear: async () => {
          calls.push("crear");
          return { id: "555000" };
        },
      }),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
      ...overrides,
    });
  }

  const currentUser = { id: "user-1", workflowOwnerId: "owner-2" };

  it("writes only the changed fields to the socio before creating the prestamo", async () => {
    const calls: string[] = [];
    const ediciones: unknown[] = [];

    await buildUseCase(calls, ediciones).execute({
      convenio: {
        caja40: { original: 100, valor: 110 },
        convAux: { original: null, valor: 80 },
        observaciones: { original: null, valor: "  Depositar en Nación " },
      },
      currentUser,
      solicitudId: "sol-1",
    });

    assert.deepEqual(calls, ["editar", "crear"]);
    assert.deepEqual(ediciones, [
      {
        campos: {
          Observaciones: "Depositar en Nación",
          "SocAux.Caja40": "110",
          "SocAux.ConvAux": "80",
        },
        socioLegacyId: "143471",
      },
    ]);
  });

  it("does not call EditarObjeto when nothing changed", async () => {
    const calls: string[] = [];

    await buildUseCase(calls, []).execute({
      convenio: {},
      currentUser,
      solicitudId: "sol-1",
    });

    assert.deepEqual(calls, ["crear"]);
  });

  it("clears a text field with an empty string", async () => {
    const ediciones: unknown[] = [];

    await buildUseCase([], ediciones).execute({
      convenio: { beneficio: { original: "733767/0", valor: null } },
      currentUser,
      solicitudId: "sol-1",
    });

    assert.deepEqual(ediciones, [
      { campos: { "SocAux.Beneficio": "" }, socioLegacyId: "143471" },
    ]);
  });

  // Vimarx guarda 0 si se manda vacio en un numero de SocAux.
  it("rejects clearing a numeric field that has a value, without creating the prestamo", async () => {
    const calls: string[] = [];

    await assert.rejects(
      buildUseCase(calls, []).execute({
        convenio: { caja40: { original: 100, valor: null } },
        currentUser,
        solicitudId: "sol-1",
      }),
      /Caja 40 no se puede borrar/,
    );
    assert.deepEqual(calls, []);
  });

  it("does not create the prestamo when Vimarx rejects the convenio", async () => {
    const calls: string[] = [];

    await assert.rejects(
      buildUseCase(calls, [], new Error("rechazado")).execute({
        convenio: { caja40: { original: 100, valor: 120 } },
        currentUser,
        solicitudId: "sol-1",
      }),
      /rechazado/,
    );
    assert.deepEqual(calls, ["editar"]);
  });

  it("preserves concurrent changes to fields omitted by the operator", async () => {
    const ediciones: unknown[] = [];
    await buildUseCase([], ediciones, undefined, {
      convenioSocioGateway: { getConvenioSocioByLegacyId: async () => ({ ...VIMARX,
        beneficio: "otro beneficio", observaciones: "Texto nuevo de Vimarx", convAux: 99 }) },
    }).execute({ convenio: { caja40: { original: 100, valor: 110 } }, currentUser, solicitudId: "sol-1" });
    assert.deepEqual(ediciones, [{ socioLegacyId: "143471", campos: { "SocAux.Caja40": "110" } }]);
  });

  it("rejects conflicts on edited text and numbers with 409 before any edit or loan creation", async () => {
    for (const convenio of [
      { caja40: { original: 90, valor: 110 } },
      { beneficio: { original: "anterior", valor: "nuevo" } },
      { observaciones: { original: "texto anterior", valor: "texto nuevo" } },
      { convAux: { original: 70, valor: 80 } },
    ]) {
      const calls: string[] = [];
      const ediciones: unknown[] = [];
      await assert.rejects(
        buildUseCase(calls, ediciones).execute({ convenio, currentUser, solicitudId: "sol-1" }),
        (error: unknown) => error instanceof ConvenioSocioConflictError && error.statusCode === 409 && /Cerrá y volvé a abrir/.test(error.message),
      );
      assert.deepEqual(calls, []);
      assert.deepEqual(ediciones, []);
    }
  });

  it("does not partially write valid edits when another edited field conflicts", async () => {
    const ediciones: unknown[] = [];
    await assert.rejects(buildUseCase([], ediciones).execute({
      convenio: { beneficio: { original: "733767/0", valor: "nuevo" }, caja40: { original: 90, valor: 110 } },
      currentUser, solicitudId: "sol-1",
    }), ConvenioSocioConflictError);
    assert.deepEqual(ediciones, []);
  });

  it("allows retrying an edit already saved in Vimarx without rewriting it", async () => {
    const calls: string[] = [];
    await buildUseCase(calls, []).execute({ convenio: { caja40: { original: 90, valor: 100 } }, currentUser, solicitudId: "sol-1" });
    assert.deepEqual(calls, ["crear"]);
  });

  it("ignores reverted fields even when their current Vimarx value changed", async () => {
    const calls: string[] = [];
    await buildUseCase(calls, []).execute({ convenio: {
      caja40: { original: 90, valor: 90 }, observaciones: { original: "viejo", valor: "viejo" },
    }, currentUser, solicitudId: "sol-1" });
    assert.deepEqual(calls, ["crear"]);
  });

  it("skips the convenio read entirely when no fields were edited", async () => {
    const uc = buildUseCase([], [], undefined, { convenioSocioGateway: {
      getConvenioSocioByLegacyId: async () => { throw new Error("must not read"); },
    } });
    for (const convenio of [undefined, {}]) await uc.execute({ convenio, currentUser, solicitudId: "sol-1" });
  });

  it("does not write the convenio when cancellation validation blocks generation", async () => {
    const calls: string[] = [];
    await assert.rejects(buildUseCase(calls, [], undefined, {
      cancelacionesRepository: cancelacionesRepository([cancelacion({ monto: 21474836.48 })]),
    }).execute({ convenio: { caja40: { original: 100, valor: 110 } }, currentUser, solicitudId: "sol-1" }), SolicitudCancelacionesFueraDeRangoError);
    assert.deepEqual(calls, []);
  });

  it("applies the same conflict check to cancelled-loan replacement preflight", async () => {
    const calls: string[] = [];
    await assert.rejects(buildUseCase(calls, [], undefined, {
      repository: solicitudesRepository({ findById: async () => solicitud({ legacyOid: "443417" }) }),
    }).prepareReplacement({ convenio: { caja40: { original: 90, valor: 110 } }, currentUser, solicitudId: "sol-1" }), ConvenioSocioConflictError);
    assert.deepEqual(calls, []);
  });

  it("rejects edits instead of silently ignoring them when reusing an active loan", async () => {
    const uc = buildLinkedUseCase({ linkedLoanReader: async () => linkedStatus });
    await assert.rejects(uc.execute({ ...linkedInput, convenio: { caja40: { original: 100, valor: 110 } } }), /ya está generado/);
  });
});
