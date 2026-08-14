import type { ListSolicitudesInput } from "../dtos/ListSolicitudes.dto";
import type { SolicitudFieldAccessRulesRepository } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { buildFieldAccessAppearanceFromRuleRecord } from "../services/SolicitudFieldAccess";
import { buildSolicitudCapabilities } from "../services/SolicitudPermissions";

type Dependencies = {
  fieldAccessRulesRepository?: SolicitudFieldAccessRulesRepository;
  repository: SolicitudesCoreRepository;
};

export class ListSolicitudesUseCase {
  private readonly fieldAccessRulesRepository?: SolicitudFieldAccessRulesRepository;
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.fieldAccessRulesRepository = dependencies.fieldAccessRulesRepository;
    this.repository = dependencies.repository;
  }

  async execute(input: ListSolicitudesInput) {
    if (input.scope === "historicas") {
      if (!this.repository.listHistoricas) {
        throw new Error("Historicas list repository method is not available.");
      }

      return this.repository
        .listHistoricas({
          limit: input.limit,
          nroDocumento: input.nroDocumento,
          offset: input.offset,
        })
        .then((solicitudes) => this.decorateSolicitudes(solicitudes, input));
    }

    if (input.scope === "recientes") {
      if (!this.repository.listRecientes) {
        throw new Error("Recientes list repository method is not available.");
      }

      const resolvedExcludeEstado = input.excludeEstado ?? "CargaVendedor";

      return this.repository
        .listRecientes({
          createdFrom: input.createdFrom,
          createdTo: input.createdTo,
          ...(resolvedExcludeEstado
            ? {
                excludeEstado: resolvedExcludeEstado,
              }
            : {}),
          ...(input.estado ? { estado: input.estado } : {}),
          limit: input.limit,
          nroDocumento: input.nroDocumento,
          offset: input.offset,
        })
        .then((solicitudes) => this.decorateSolicitudes(solicitudes, input));
    }

    if (input.scope === "tracking") {
      if (!this.repository.listTracking) {
        throw new Error("Tracking list repository method is not available.");
      }

      return this.repository
        .listTracking({
          createdFrom: input.createdFrom,
          createdTo: input.createdTo,
          ...(input.excludeEstado
            ? {
                excludeEstado: input.excludeEstado,
              }
            : {}),
          ...(input.estado ? { estado: input.estado } : {}),
          limit: input.limit,
          nroDocumento: input.nroDocumento,
          offset: input.offset,
          userId: input.currentUser.id,
        })
        .then((solicitudes) => this.decorateSolicitudes(solicitudes, input));
    }

    return this.repository
      .listByOwner({
        createdFrom: input.createdFrom,
        createdTo: input.createdTo,
        ...(input.excludeEstado
          ? {
              excludeEstado: input.excludeEstado,
            }
          : {}),
        estado: input.estado,
        limit: input.limit,
        nroDocumento: input.nroDocumento,
        offset: input.offset,
        workflowOwnerId:
          input.workflowOwnerId ??
          input.currentUser.workflowOwnerId ??
          (input.currentUser.isSystemAdmin ? undefined : ""),
      })
      .then((solicitudes) => this.decorateSolicitudes(solicitudes, input));
  }

  private async decorateSolicitudes(
    solicitudes: Awaited<ReturnType<SolicitudesCoreRepository["listByOwner"]>>,
    input: ListSolicitudesInput,
  ) {
    const fieldAccessByStateId = new Map<string, {
      active: boolean;
      backgroundColor: string | null;
      canManageAttachments: boolean;
      defaultMode: "readonly";
      editableFields: string[];
      editableGroups: string[];
      readonlyReason: string | null;
      textColor: string | null;
      workflowStateId: string;
    } | null>();
    const appearanceByStateId = new Map<
      string,
      Awaited<ReturnType<typeof buildFieldAccessAppearanceFromRuleRecord>>
    >();

    if (this.fieldAccessRulesRepository) {
      const workflowStateIds = Array.from(
        new Set(solicitudes.map((solicitud) => solicitud.estadoActual.id)),
      );

      const rules =
        workflowStateIds.length === 0
          ? []
          : await this.fieldAccessRulesRepository.findByWorkflowStateIds(
              workflowStateIds,
            );

      for (const workflowStateId of workflowStateIds) {
        fieldAccessByStateId.set(workflowStateId, null);
        appearanceByStateId.set(workflowStateId, {
          backgroundColor: null,
          textColor: null,
        });
      }

      for (const rule of rules) {
        fieldAccessByStateId.set(rule.workflowStateId, rule);
        appearanceByStateId.set(
          rule.workflowStateId,
          buildFieldAccessAppearanceFromRuleRecord(rule),
        );
      }
    }

    // Solo se necesita el codigo de owner del usuario para la excepcion de
    // RIESGO en "Transferir" (ver SolicitudPermissions.canEditSolicitud).
    const hasTransferirRow = solicitudes.some(
      (solicitud) => solicitud.estadoActual.code === "Transferir",
    );
    const workflowOwnerCode =
      !input.currentUser.isSystemAdmin &&
      hasTransferirRow &&
      input.currentUser.workflowOwnerId &&
      this.repository.findWorkflowOwnerCodeById
        ? await this.repository.findWorkflowOwnerCodeById(
            input.currentUser.workflowOwnerId,
          )
        : null;
    const currentUser = {
      ...input.currentUser,
      ...(workflowOwnerCode ? { workflowOwnerCode } : {}),
    };

    return solicitudes.map((solicitud) => ({
      ...solicitud,
      appearance:
        appearanceByStateId.get(solicitud.estadoActual.id) ?? {
          backgroundColor: null,
          textColor: null,
        },
      capabilities: buildSolicitudCapabilities(
        currentUser,
        solicitud,
        fieldAccessByStateId.get(solicitud.estadoActual.id) ?? null,
      ),
    }));
  }
}
