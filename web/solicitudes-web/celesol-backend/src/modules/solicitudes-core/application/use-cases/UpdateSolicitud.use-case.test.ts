import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import {
  ForbiddenSolicitudAccessError,
  SolicitudFieldNotEditableInCurrentStateError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type {
  SolicitudesCoreRepository,
  UpdateSolicitudCorePatch,
} from "../../domain/repositories/SolicitudesCoreRepository";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";
import { EDITABLE_FIELDS } from "../services/SolicitudFieldAccess";
import { UpdateSolicitudUseCase } from "./UpdateSolicitud.use-case";

describe("UpdateSolicitudUseCase", () => {
  it("allows update for current owner even when user is not creator and not participant", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;
    const useCase = buildUseCase({
      findById: async () =>
        solicitudCore({
          createdBy: "creator-1",
          participants: [],
        }),
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          motivo: patch.solicitud?.motivo ?? "Compra",
        });
      },
    });

    const result = await useCase.execute(
      updateInput({
        currentUser: {
          id: "operator-1",
          workflowOwnerId: "owner-1",
        },
        createdBy: "operator-1",
        solicitud: {
          motivo: "Actualizado",
        },
      }),
    );

    assert.equal(result.motivo, "Actualizado");
    assert.deepEqual(receivedPatch, {
      solicitud: {
        motivo: "Actualizado",
      },
    });
  });

  it("allows an analista to edit a normal field outside their current owner, but rejects a blocked field", async () => {
    const useCase = buildUseCase({
      findById: async () =>
        solicitudCore({
          estadoActual: {
            code: "CargaVendedor",
            id: "state-carga",
            name: "Carga vendedor",
            owner: { code: "VENDEDORES", id: "owner-vendedores", name: "Vendedores" },
            ownerId: "owner-vendedores",
          },
        }),
      update: async (_id, patch) => ({
        ...solicitudCore(),
        observaciones:
          patch.solicitud?.observaciones ?? solicitudCore().observaciones,
      }),
    });

    const result = await useCase.execute(
      updateInput({
        currentUser: {
          id: "riesgo-1",
          isAnalista: true,
          workflowOwnerId: "owner-riesgo",
        },
        solicitud: { observaciones: "actualizado por analista" },
      }),
    );

    assert.equal(result.observaciones, "actualizado por analista");

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "riesgo-1",
              isAnalista: true,
              workflowOwnerId: "owner-riesgo",
            },
            solicitud: { ejecutivoSolicitud: "otro-ejecutivo" },
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );
  });

  it("rejects update in Confirmada even when owner matches", async () => {
    const useCase = buildUseCase({
      findById: async () =>
        solicitudCore({
          estadoActual: {
            code: "Confirmada",
            id: "state-2",
            name: "Confirmada",
            ownerId: "owner-riesgo",
          },
        }),
    });

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "riesgo-1",
              workflowOwnerId: "owner-riesgo",
            },
            createdBy: "riesgo-1",
            solicitud: {
              observaciones: "Cambio bloqueado",
            },
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );
  });

  it("rejects creator outside current owner", async () => {
    const useCase = buildUseCase({
      findById: async () =>
        solicitudCore({
          createdBy: "creator-1",
        }),
    });

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "creator-1",
              workflowOwnerId: "owner-2",
            },
            createdBy: "creator-1",
            solicitud: {
              motivo: "Actualizado",
            },
          }),
        ),
      ForbiddenSolicitudAccessError,
    );
  });

  it("rejects participant outside current owner", async () => {
    const useCase = buildUseCase({
      findById: async () =>
        solicitudCore({
          participants: [{ userId: "participant-1" }],
        }),
    });

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "participant-1",
              workflowOwnerId: "owner-2",
            },
            createdBy: "participant-1",
            solicitud: {
              motivo: "Actualizado",
            },
          }),
        ),
      ForbiddenSolicitudAccessError,
    );
  });

  it("rejects unrelated user without owner match", async () => {
    const useCase = buildUseCase();

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "user-404",
              workflowOwnerId: null,
            },
            createdBy: "user-404",
            solicitud: {
              motivo: "Actualizado",
            },
          }),
        ),
      ForbiddenSolicitudAccessError,
    );
  });

  it("allows a system admin to edit a blocked field from outside the current owner", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;
    const useCase = buildUseCase({
      findById: async () =>
        solicitudCore({
          createdBy: "creator-1",
        }),
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          ejecutivoSolicitud:
            patch.solicitud?.ejecutivoSolicitud ??
            solicitudCore().ejecutivoSolicitud,
        });
      },
    });

    const result = await useCase.execute(
      updateInput({
        currentUser: {
          id: "admin-1",
          isSystemAdmin: true,
          workflowOwnerId: null,
        },
        createdBy: "admin-1",
        solicitud: {
          ejecutivoSolicitud: "Reasignado por soporte",
        },
      }),
    );

    assert.equal(result.ejecutivoSolicitud, "Reasignado por soporte");
    assert.deepEqual(receivedPatch, {
      solicitud: {
        ejecutivoSolicitud: "Reasignado por soporte",
      },
    });
  });

  it("keeps partial patch semantics", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;
    const useCase = buildUseCase({
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          motivo: patch.solicitud?.motivo ?? "Compra",
          observaciones: "Inicial",
          titular: {
            ...solicitudCore().titular,
            telefonoFijo:
              patch.titular?.telefonoFijo ?? solicitudCore().titular.telefonoFijo,
          },
        });
      },
    });

    const updated = await useCase.execute(
      updateInput({
        currentUser: {
          id: "operator-1",
          workflowOwnerId: "owner-1",
        },
        createdBy: "operator-1",
        solicitud: {
          motivo: "Actualizado",
          observaciones: null,
        },
        titular: {
          telefonoFijo: "1144442222",
        },
      }),
    );

    assert.equal(updated.motivo, "Actualizado");
    assert.equal(updated.observaciones, "Inicial");
    assert.equal(updated.titular.telefonoFijo, "1144442222");
    assert.deepEqual(receivedPatch, {
      solicitud: {
        motivo: "Actualizado",
        observaciones: null,
      },
      titular: {
        telefonoFijo: "1144442222",
      },
    });
  });

  it("rejects line field before business validations", async () => {
    let catalogCalled = false;
    const useCase = buildUseCase({
      lineasPrestamoCatalog: {
        findByLegacyUserAndOid: async () => {
          catalogCalled = true;
          return null;
        },
      },
    });

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "operator-1",
              workflowOwnerId: "owner-1",
            },
            createdBy: "operator-1",
            solicitud: {
              lineaPrestamoLegacyOid: "LP-404",
            },
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );

    assert.equal(catalogCalled, false);
  });

  it("allows linkFirmaDigital when enabled by field access", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;

    await buildUseCase({
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          linkFirmaDigital:
            patch.solicitud?.linkFirmaDigital ?? solicitudCore().linkFirmaDigital,
        });
      },
    }).execute(
      updateInput({
        solicitud: {
          linkFirmaDigital: "https://firma.example.com",
        },
      }),
    );

    assert.deepEqual(receivedPatch, {
      solicitud: {
        linkFirmaDigital: "https://firma.example.com",
      },
    });
  });

  it("allows firmaDigitalmente when enabled by field access", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;

    await buildUseCase({
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          firmaDigitalmente:
            patch.solicitud?.firmaDigitalmente ??
            solicitudCore().firmaDigitalmente,
        });
      },
    }).execute(
      updateInput({
        solicitud: {
          firmaDigitalmente: true,
        },
      }),
    );

    assert.deepEqual(receivedPatch, {
      solicitud: {
        firmaDigitalmente: true,
      },
    });
  });

  it("rejects linkFirmaDigital when it is not enabled by the persisted rule", async () => {
    await assert.rejects(
      () =>
        buildUseCase({
          fieldAccessRulesRepository: buildFieldAccessRulesRepository({
            findByWorkflowStateId: async (workflowStateId) => ({
              active: true,
              backgroundColor: null,
              canManageAttachments: true,
              defaultMode: "readonly",
              editableFields: ["solicitud.motivo"],
              editableGroups: [],
              readonlyReason: null,
              textColor: null,
              workflowStateId,
            }),
          }),
        }).execute(
          updateInput({
            solicitud: {
              linkFirmaDigital: "https://firma.example.com",
            },
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );
  });

  it("rejects firmaDigitalmente when it is not enabled by the persisted rule", async () => {
    await assert.rejects(
      () =>
        buildUseCase({
          fieldAccessRulesRepository: buildFieldAccessRulesRepository({
            findByWorkflowStateId: async (workflowStateId) => ({
              active: true,
              backgroundColor: null,
              canManageAttachments: true,
              defaultMode: "readonly",
              editableFields: ["solicitud.motivo"],
              editableGroups: [],
              readonlyReason: null,
              textColor: null,
              workflowStateId,
            }),
          }),
        }).execute(
          updateInput({
            solicitud: {
              firmaDigitalmente: true,
            },
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );
  });

  it("rejects garantias in readonly states", async () => {
    await assert.rejects(
      () =>
        buildUseCase({
          findById: async () =>
            solicitudCore({
              estadoActual: {
                code: "RevisionRiesgo",
                id: "state-2",
                name: "Revision Riesgo",
                ownerId: "owner-1",
              },
            }),
        }).execute(
          updateInput({
            garantias: [{ nombre: "Gar 1" }],
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );
  });

  it("allows garantias field-by-field in CargaVendedor", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;
    const useCase = buildUseCase({
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          garantias: patch.garantias ?? [],
        });
      },
    });

    await useCase.execute(
      updateInput({
        garantias: [{ nombre: "Gar 1", sumaIngresos: true }],
      }),
    );

    if (!receivedPatch) {
      assert.fail("Expected patch to be captured");
    }

    const capturedPatch: UpdateSolicitudCorePatch = receivedPatch;
    assert.deepEqual(capturedPatch.garantias, [
      {
        antiguedadLaboralMeses: null,
        casadoConTitular: null,
        celular: null,
        cuit: null,
        denominacion: null,
        domicilio: null,
        edad: null,
        email: null,
        estadoCivil: null,
        fechaIngresoLaboral: null,
        fechaNacimiento: null,
        ingresoMensual: null,
        nacionalidad: null,
        nombre: "Gar 1",
        nombreCompleto: null,
        nroDocumento: null,
        nroSocio: null,
        observaciones: null,
        ocupacion: null,
        persona: null,
        sexo: null,
        sumaIngresos: true,
        telefono: null,
        tipoDocumento: null,
        tipoGarantia: null,
        tipoRelacion: null,
      },
    ]);
  });

  it("keeps legacy garantias editableGroups compatible during transition", async () => {
    let receivedPatch: UpdateSolicitudCorePatch | null = null;
    const useCase = buildUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository({
        findByWorkflowStateId: async (workflowStateId) => ({
          active: true,
          backgroundColor: null,
          canManageAttachments: true,
          defaultMode: "readonly",
          editableFields: [],
          editableGroups: ["garantias"],
          readonlyReason: null,
          textColor: null,
          workflowStateId,
        }),
      }),
      update: async (_id, patch) => {
        receivedPatch = patch;
        return solicitudCore({
          garantias: patch.garantias ?? [],
        });
      },
    });

    await useCase.execute(
      updateInput({
        garantias: [{ email: "garantia@example.com" }],
      }),
    );

    assert.notEqual(receivedPatch, null);
  });

  it("rejects updates when an editable state has no persisted rule", async () => {
    const useCase = buildUseCase({
      fieldAccessRulesRepository: buildFieldAccessRulesRepository({
        findByWorkflowStateId: async () => null,
      }),
    });

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            solicitud: {
              motivo: "Actualizado",
            },
          }),
        ),
      SolicitudFieldNotEditableInCurrentStateError,
    );
  });

  it("rejects when the solicitud does not exist", async () => {
    const useCase = buildUseCase({
      findById: async () => null,
    });

    await assert.rejects(
      () =>
        useCase.execute(
          updateInput({
            currentUser: {
              id: "operator-1",
              workflowOwnerId: "owner-1",
            },
            createdBy: "operator-1",
          }),
        ),
      SolicitudCoreNotFoundError,
    );
  });
});

function buildUseCase(overrides?: {
  fieldAccessRulesRepository?: SolicitudFieldAccessRulesRepository;
  findById?: SolicitudesCoreRepository["findById"];
  lineasPrestamoCatalog?: LineasPrestamoCatalog;
  update?: SolicitudesCoreRepository["update"];
}) {
  const repository: SolicitudesCoreRepository = {
    create: async () => {
      throw new Error("not used");
    },
    findById: overrides?.findById ?? (async () => solicitudCore()),
    listByOwner: async () => [],
    update:
      overrides?.update ??
      (async (_id, patch) => ({
        ...solicitudCore(),
        datosLaborales: {
          ...solicitudCore().datosLaborales,
          empleador:
            patch.datosLaborales?.empleador ?? solicitudCore().datosLaborales.empleador,
        },
        motivo: patch.solicitud?.motivo ?? solicitudCore().motivo,
        observaciones:
          patch.solicitud?.observaciones ?? solicitudCore().observaciones,
        titular: {
          ...solicitudCore().titular,
          telefonoFijo:
            patch.titular?.telefonoFijo ?? solicitudCore().titular.telefonoFijo,
        },
      })),
  };

  return new UpdateSolicitudUseCase({
    fieldAccessRulesRepository:
      overrides?.fieldAccessRulesRepository ?? buildFieldAccessRulesRepository(),
    lineasPrestamoCatalog:
      overrides?.lineasPrestamoCatalog ??
      ({
        findByLegacyUserAndOid: async () => {
          throw new Error("not used");
        },
      } as LineasPrestamoCatalog),
    repository,
  });
}

function buildFieldAccessRulesRepository(overrides?: {
  findByWorkflowStateId?: SolicitudFieldAccessRulesRepository["findByWorkflowStateId"];
  findByWorkflowStateIds?: SolicitudFieldAccessRulesRepository["findByWorkflowStateIds"];
}): SolicitudFieldAccessRulesRepository {
  return {
    findByWorkflowStateId:
      overrides?.findByWorkflowStateId ??
      (async (workflowStateId) => {
        if (workflowStateId === "state-1") {
          return {
            active: true,
            backgroundColor: null,
            canManageAttachments: true,
            defaultMode: "readonly",
            editableFields: [...EDITABLE_FIELDS],
            editableGroups: [],
            readonlyReason: null,
            textColor: null,
            workflowStateId,
          };
        }

        return null;
      }),
    findByWorkflowStateIds:
      overrides?.findByWorkflowStateIds ??
      (async (workflowStateIds) => {
        const records = await Promise.all(
          workflowStateIds.map((workflowStateId) =>
            buildFieldAccessRulesRepository().findByWorkflowStateId(
              workflowStateId,
            ),
          ),
        );

        return records.filter(
          (record): record is NonNullable<typeof record> => record !== null,
        );
      }),
  };
}

function updateInput(overrides?: Partial<UpdateSolicitudInput>): UpdateSolicitudInput {
  return {
    createdBy: "user-1",
    createdByLegacyUser: "seller-1",
    currentUser: {
      id: "user-1",
      workflowOwnerId: "owner-1",
    },
    id: "sol-1",
    ...overrides,
  };
}

function solicitudCore(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    conyuge: null,
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    createdBy: "creator-1",
    cuotaResultante: "10000",
    cuotas: 12,
    cupoTitular: 150000,
    datosLaborales: {
      actividadLaboral: "Administrativa",
      antiguedadLaboralMeses: 24,
      descuentosSueldo: 1000,
      domicilioLaboralCalle: "Oficina",
      domicilioLaboralLocalidad: "CABA",
      domicilioLaboralNroPuerta: "123",
      domicilioLaboralPisoDepto: "4B",
      empleador: "Empresa SA",
      fechaIngresoLaboral: "2024-01-10",
      montoRecibo: 250000,
      relacionLaboral: "Dependencia",
      tarjetas: "Visa",
      vehiculo: "No",
      vivienda: "Propia",
    },
    ejecutivoSolicitud: "Ejecutivo Uno",
    estadoActual: {
      code: "CargaVendedor",
      id: "state-1",
      name: "Carga vendedor",
      ownerId: "owner-1",
    },
    fechaPrimerVencimiento: "2026-06-01",
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: 100000,
    motivo: "Compra",
    nroOperacion: "OP-321",
    nroSolicitud: null,
    observaciones: "Inicial",
    participants: [],
    titular: {
      apellidoDenominacion: "Perez",
      cbu: "2850590940090418135201",
      celular: "1122334455",
      cuit: "20333444559",
      domicilioCalle: "Siempre Viva",
      email: "juan@example.com",
      estadoCivil: "Soltero",
      localidad: "CABA",
      nacionalidad: "Argentina",
      nombre: "Juan",
      nroDocumento: "33344455",
      nroPuerta: "742",
      nroSocio: "SM-1",
      personaExpuestaPoliticamente: false,
      sexo: "M",
      telefonoFijo: "1144441111",
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: "Vendedor Uno",
    ...overrides,
  };
}
