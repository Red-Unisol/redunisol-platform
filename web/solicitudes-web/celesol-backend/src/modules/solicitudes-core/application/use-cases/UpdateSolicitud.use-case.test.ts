import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import {
  ForbiddenSolicitudAccessError,
  LineaPrestamoNoDisponibleParaSolicitudError,
  MontoSuperaAprobadoRiesgoError,
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
import type { LinkedLoanReader } from "../services/LinkedLoanRules";

describe("UpdateSolicitudUseCase", () => {
  it("permite correcciones de Riesgo en Vendedores respetando campos y asignación", async () => {
    const target = solicitudCore();
    target.estadoActual = { ...target.estadoActual, code: "PreAprobada", owner: { id: "owner-1", code: "VENDEDORES", name: "Vendedores" } };
    const useCase = buildUseCase({
      findById: async () => target,
      findWorkflowOwnerCodeById: async id => { assert.equal(id, "owner-riesgo"); return "RIESGO"; },
      fieldAccessRulesRepository: reglaSinLinea(),
    });
    const actor = { id: "analyst", workflowOwnerId: "owner-riesgo" };
    const result = await useCase.execute(updateInput({ currentUser: actor, solicitud: { observaciones: "Corrección de riesgo" } }));
    assert.equal(result.observaciones, "Corrección de riesgo");
    await assert.rejects(useCase.execute(updateInput({ currentUser: actor, solicitud: { lineaPrestamoLegacyOid: "LP-2" } })), SolicitudFieldNotEditableInCurrentStateError);
    await assert.rejects(useCase.execute(updateInput({ currentUser: actor, solicitud: { vendedorSolicitud: "Otro vendedor" } })), SolicitudFieldNotEditableInCurrentStateError);
    await assert.rejects(useCase.execute(updateInput({ currentUser: actor, solicitud: { cuotaResultante: "1" } })), SolicitudFieldNotEditableInCurrentStateError);
    const treasury = buildUseCase({ findById: async () => target, findWorkflowOwnerCodeById: async () => "TESORERIA" });
    await assert.rejects(treasury.execute(updateInput({ currentUser: actor, solicitud: { observaciones: "No autorizado" } })), ForbiddenSolicitudAccessError);
  });

  for (const isSystemAdmin of [false, true]) {
    it(`rechaza cambiar o borrar el vendedor (admin=${isSystemAdmin})`, async () => {
      let updated = false;
      const useCase = buildUseCase({
        findById: async () => solicitudCore(),
        update: async () => { updated = true; return solicitudCore(); },
      });
      for (const vendedorSolicitud of ["Otro vendedor", null]) {
        await assert.rejects(
          () => useCase.execute(updateInput({
            currentUser: { id: "operator-1", workflowOwnerId: "owner-1", isSystemAdmin },
            solicitud: { vendedorSolicitud },
          })),
          SolicitudFieldNotEditableInCurrentStateError,
        );
      }
      assert.equal(updated, false);
    });
  }

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
      fieldAccessRulesRepository: reglaSinLinea(),
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

  describe("cambio de linea", () => {
    const enRiesgo = {
      estadoActual: {
        code: "Revisar",
        id: "state-1",
        name: "Revisar",
        ownerId: "owner-riesgo",
      },
    };
    const lineaCancel = {
      cantidadMaximaCuotas: 24,
      cantidadMinimaCuotas: 1,
      descripcion: "CRUZ DEL EJE -Cancel-Prem",
      legacyOid: "2703",
      montoMaximo: 6000000,
      montoMinimo: null,
      vigente: true,
    };
    const analistaRiesgo = {
      id: "riesgo-1",
      workflowOwnerId: "owner-riesgo",
    };

    it("la cambia quien tiene la solicitud a cargo si la regla del estado la habilita, con las lineas del vendedor", async () => {
      let receivedPatch: UpdateSolicitudCorePatch | null = null;
      let consultadoCon: string | null = null;
      const useCase = buildUseCase({
        findById: async () => solicitudCore(enRiesgo),
        findVendedorLegacyUser: async () => "vendedor-cruz",
        lineasPrestamoCatalog: {
          findByLegacyUserAndOid: async (legacyUser) => {
            consultadoCon = legacyUser;
            return lineaCancel;
          },
        },
        update: async (_id, patch) => {
          receivedPatch = patch;
          return solicitudCore();
        },
      });

      await useCase.execute(
        updateInput({
          createdByLegacyUser: "analista-riesgo",
          currentUser: analistaRiesgo,
          solicitud: { lineaPrestamoLegacyOid: "2703" },
        }),
      );

      assert.equal(consultadoCon, "vendedor-cruz");
      assert.deepEqual(receivedPatch, {
        solicitud: {
          lineaPrestamoDescripcion: "CRUZ DEL EJE -Cancel-Prem",
          lineaPrestamoLegacyOid: "2703",
          montoAFinanciar: 100000, cuotas: 12, cuotaResultante: null,
        },
      });
    });

    it("no la deja cambiar si la regla del estado no la habilita", async () => {
      const useCase = buildUseCase({
        fieldAccessRulesRepository: reglaSinLinea(),
        findById: async () => solicitudCore(),
      });

      await assert.rejects(
        () =>
          useCase.execute(
            updateInput({
              solicitud: { lineaPrestamoLegacyOid: "2703" },
            }),
          ),
        SolicitudFieldNotEditableInCurrentStateError,
      );
    });

    it("rechaza una linea que no es del agente del vendedor", async () => {
      const useCase = buildUseCase({
        findById: async () => solicitudCore(enRiesgo),
        findVendedorLegacyUser: async () => "vendedor-cruz",
        lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => null },
      });

      await assert.rejects(
        () =>
          useCase.execute(
            updateInput({
              currentUser: analistaRiesgo,
              solicitud: { lineaPrestamoLegacyOid: "9999" },
            }),
          ),
        LineaPrestamoNoDisponibleParaSolicitudError,
      );
    });

    it("ajusta automáticamente las cuotas al máximo de la nueva línea", async () => {
      let patch: UpdateSolicitudCorePatch | undefined;
      const useCase = buildUseCase({
        findById: async () => solicitudCore({ ...enRiesgo, cuotas: 36 }),
        findVendedorLegacyUser: async () => "vendedor-cruz",
        lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => lineaCancel },
        update: async (_id, p) => { patch = p; return solicitudCore(); },
      });
      await useCase.execute(updateInput({ currentUser: analistaRiesgo, solicitud: { lineaPrestamoLegacyOid: "2703" } }));
      assert.equal(patch?.solicitud?.cuotas, 24);
      assert.equal(patch?.solicitud?.cuotaResultante, null);
    });

    it("acepta el cambio si en el mismo guardado se ajustan las cuotas", async () => {
      let receivedPatch: UpdateSolicitudCorePatch | null = null;
      const useCase = buildUseCase({
        findById: async () => solicitudCore({ ...enRiesgo, cuotas: 36 }),
        findVendedorLegacyUser: async () => "vendedor-cruz",
        lineasPrestamoCatalog: {
          findByLegacyUserAndOid: async () => lineaCancel,
        },
        update: async (_id, patch) => {
          receivedPatch = patch;
          return solicitudCore();
        },
      });

      await useCase.execute(
        updateInput({
          currentUser: analistaRiesgo,
          solicitud: { cuotas: 24, lineaPrestamoLegacyOid: "2703" },
        }),
      );

      assert.equal((receivedPatch as UpdateSolicitudCorePatch | null)?.solicitud?.cuotas, 24);
      assert.equal((receivedPatch as UpdateSolicitudCorePatch | null)?.solicitud?.lineaPrestamoLegacyOid, "2703");
    });

    it("deja cambiarla a un admin", async () => {
      let receivedPatch: UpdateSolicitudCorePatch | null = null;
      const useCase = buildUseCase({
        findVendedorLegacyUser: async () => "vendedor-cruz",
        lineasPrestamoCatalog: {
          findByLegacyUserAndOid: async () => lineaCancel,
        },
        update: async (_id, patch) => {
          receivedPatch = patch;
          return solicitudCore();
        },
      });

      await useCase.execute(
        updateInput({
          currentUser: {
            id: "admin-1",
            isSystemAdmin: true,
            workflowOwnerId: null,
          },
          solicitud: { lineaPrestamoLegacyOid: "2703" },
        }),
      );

      assert.equal((receivedPatch as UpdateSolicitudCorePatch | null)?.solicitud?.lineaPrestamoLegacyOid, "2703");
    });
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

describe("tope del monto aprobado por Riesgo", () => {
  const preAprobada = {
    estadoActual: {
      code: "PreAprobada",
      id: "state-1",
      name: "Pre Aprobada",
      ownerId: "owner-1",
    },
    montoAFinanciar: 300000,
    montoAprobadoRiesgo: 500000,
  };

  async function guardarMonto(
    montoAFinanciar: number,
    options: {
      solicitud?: Partial<SolicitudCore>;
      isAnalista?: boolean;
      workflowOwnerCode?: string;
    } = {},
  ) {
    let patch: UpdateSolicitudCorePatch | undefined;
    const useCase = buildUseCase({
      findById: async () => solicitudCore({ ...preAprobada, ...options.solicitud }),
      findWorkflowOwnerCodeById: async () => options.workflowOwnerCode ?? null,
      update: async (_id, p) => {
        patch = p;
        return solicitudCore();
      },
    });
    await useCase.execute(
      updateInput({
        currentUser: {
          id: "user-1",
          workflowOwnerId: "owner-1",
          ...(options.isAnalista ? { isAnalista: true } : {}),
        },
        solicitud: { montoAFinanciar },
      }),
    );
    return patch?.solicitud;
  }

  it("el vendedor puede bajar el monto", async () => {
    assert.equal((await guardarMonto(200000))?.montoAFinanciar, 200000);
  });

  it("el vendedor puede volver a subirlo hasta el aprobado", async () => {
    assert.equal((await guardarMonto(500000))?.montoAFinanciar, 500000);
  });

  it("el vendedor no puede pasar del aprobado, tambien en Revisar", async () => {
    await assert.rejects(() => guardarMonto(500001), MontoSuperaAprobadoRiesgoError);
    await assert.rejects(
      () =>
        guardarMonto(600000, {
          solicitud: {
            estadoActual: { ...preAprobada.estadoActual, code: "Revisar", name: "Revisar" },
          },
        }),
      /máximo es el devuelto por Riesgo: \$500\.000\./,
    );
  });

  it("Riesgo no tiene tope y su monto pasa a ser el nuevo aprobado", async () => {
    const guardado = await guardarMonto(600000, { workflowOwnerCode: "RIESGO" });
    assert.equal(guardado?.montoAFinanciar, 600000);
    assert.equal(guardado?.montoAprobadoRiesgo, 600000);
  });

  it("el vendedor no cambia el tope al bajar el monto", async () => {
    const guardado = await guardarMonto(200000);
    assert.equal(guardado?.montoAprobadoRiesgo, undefined);
  });

  it("el analista no tiene tope", async () => {
    assert.equal((await guardarMonto(600000, { isAnalista: true }))?.montoAFinanciar, 600000);
  });

  it("no aplica fuera de los estados que vuelven de Riesgo ni sin tope guardado", async () => {
    assert.equal(
      (
        await guardarMonto(600000, {
          solicitud: {
            estadoActual: { ...preAprobada.estadoActual, code: "CargaVendedor", name: "Carga vendedor" },
          },
        })
      )?.montoAFinanciar,
      600000,
    );
    assert.equal(
      (await guardarMonto(600000, { solicitud: { montoAprobadoRiesgo: null } }))
        ?.montoAFinanciar,
      600000,
    );
  });
});

function buildUseCase(overrides?: {
  linkedLoanReader?: LinkedLoanReader;
  fieldAccessRulesRepository?: SolicitudFieldAccessRulesRepository;
  findById?: SolicitudesCoreRepository["findById"];
  findWorkflowOwnerCodeById?: SolicitudesCoreRepository["findWorkflowOwnerCodeById"];
  findVendedorLegacyUser?: SolicitudesCoreRepository["findVendedorLegacyUser"];
  lineasPrestamoCatalog?: LineasPrestamoCatalog;
  update?: SolicitudesCoreRepository["update"];
}) {
  const repository: SolicitudesCoreRepository = {
    create: async () => {
      throw new Error("not used");
    },
    findById: overrides?.findById ?? (async () => solicitudCore()),
    findWorkflowOwnerCodeById: overrides?.findWorkflowOwnerCodeById ?? (async () => null),
    findVendedorLegacyUser: overrides?.findVendedorLegacyUser ?? (async () => "seller-legacy"),
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
    linkedLoanReader: overrides?.linkedLoanReader,
      simularCuotaSolicitud: { execute: async () => null },
    fieldAccessRulesRepository:
      overrides?.fieldAccessRulesRepository ?? buildFieldAccessRulesRepository(),
    lineasPrestamoCatalog:
      overrides?.lineasPrestamoCatalog ??
      ({
        findByLegacyUserAndOid: async () => {
          return { descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 };
        },
      } as LineasPrestamoCatalog),
    repository,
  });
}

describe("monto congelado por préstamo vinculado", () => {
  const linked = () => solicitudCore({ legacyOid: "444" });
  const status = { status: "active" as const, currentLoanId: "444", resolvedLoanId: "444", amount: 100000, requestedAmount: 100000, matchesAmount: true, amountEditable: false };

  for (const isSystemAdmin of [false, true]) it(`bloquea cambios con préstamo vigente también para admin=${isSystemAdmin}`, async () => {
    let writes = 0;
    const uc = buildUseCase({ findById: async () => linked(), linkedLoanReader: async () => status,
      update: async () => { writes++; return linked(); } });
    await assert.rejects(uc.execute(updateInput({ currentUser: { id: "operator-1", workflowOwnerId: "owner-1", isSystemAdmin }, solicitud: { montoAFinanciar: 50000 } })), /congelado.*444/);
    assert.equal(writes, 0);
  });

  it("permite monto nuevo tras anulación probada y entrega el guard de préstamo verificado", async () => {
    let savedGuard: unknown;
    const uc = buildUseCase({ findById: async () => linked(), linkedLoanReader: async () => ({ ...status, status: "cancelled", amountEditable: true }),
      update: async (_id, _patch, guard) => { savedGuard = guard; return linked(); } });
    await uc.execute(updateInput({ solicitud: { montoAFinanciar: 50000 } }));
    assert.deepEqual(savedGuard, { expectedEstadoActualId: "state-1", enforceMontoAprobadoRiesgo: true, expectedLegacyOid: "444", cancelledLoanId: "444" });
  });

  it("sin poder verificar Vimarx no modifica el monto", async () => {
    const uc = buildUseCase({ findById: async () => linked() });
    await assert.rejects(uc.execute(updateInput({ solicitud: { montoAFinanciar: 50000 } })), /permanece bloqueado/);
  });

  it("un ajuste implícito por máximo de línea también respeta el congelamiento", async () => {
    const uc = buildUseCase({ findById: async () => linked(), linkedLoanReader: async () => status,
      lineasPrestamoCatalog: { findByLegacyUserAndOid: async () => ({ descripcion: "Personal", legacyOid: "LP-1", vigente: true, montoMaximo: 50000, cantidadMaximaCuotas: 48 }) } });
    await assert.rejects(uc.execute(updateInput({ solicitud: { observaciones: "Otro dato" } })), /congelado/);
  });
});

// Regla del estado state-1 con todos los campos menos la linea.
function reglaSinLinea(): SolicitudFieldAccessRulesRepository {
  return buildFieldAccessRulesRepository({
    findByWorkflowStateId: async (workflowStateId) => ({
      active: true,
      backgroundColor: null,
      canManageAttachments: true,
      defaultMode: "readonly",
      editableFields: EDITABLE_FIELDS.filter(
        (field) => field !== "solicitud.lineaPrestamoLegacyOid",
      ),
      editableGroups: [],
      readonlyReason: null,
      textColor: null,
      workflowStateId,
    }),
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
      cbuNoHabitual: null,
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

it("adjusts API changes on the same line with the seller catalog and clears failed calculations", async () => {
  let patch: UpdateSolicitudCorePatch | undefined;
  let catalogUser: string | undefined;
  const useCase = buildUseCase({
    findVendedorLegacyUser: async () => "seller-area",
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async (user, oid) => {
      catalogUser = user;
      return { descripcion: "Personal", legacyOid: oid, vigente: true, montoMaximo: 50000, cantidadMaximaCuotas: 6 };
    } },
    update: async (_id, p) => { patch = p; return solicitudCore(); },
  });
  await useCase.execute(updateInput({ solicitud: { montoAFinanciar: 1000000, cuotas: 48 } }));
  assert.equal(catalogUser, "seller-area");
  assert.equal(patch?.solicitud?.montoAFinanciar, 50000);
  assert.equal(patch?.solicitud?.cuotas, 6);
  assert.equal(patch?.solicitud?.cuotaResultante, null);
});
it("rejects manual installment changes even for system administrators", async () => {
  await assert.rejects(buildUseCase().execute(updateInput({ currentUser: { id: "admin", isSystemAdmin: true, workflowOwnerId: null }, solicitud: { cuotaResultante: "12345" } })), SolicitudFieldNotEditableInCurrentStateError);
});
