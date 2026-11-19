import type { DbClient } from "../../../../db/prisma";
import type { ChangeSolicitudStateInput } from "../../application/dtos/ChangeSolicitudState.dto";
import type { UpdateSolicitudUseCase } from "../../application/use-cases/UpdateSolicitud.use-case";
import type { WorkflowCommand } from "../../domain/workflow/types";
import { SolicitudWorkflowCapabilitiesService } from "../../application/services/SolicitudWorkflowCapabilitiesService";
import { readSellerReviewChanges } from "../../application/services/SellerReviewChanges";
import { assertAnalysisControl } from "../../domain/workflow/SellerReview";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { AdministrativeCorrectionError } from "../../domain/workflow/AdministrativeCorrection";
import { ForbiddenSolicitudAccessError, SolicitudCoreNotFoundError, SolicitudTitularSocioRequiredForWorkflowError } from "../../domain/solicitudes-core-errors";
import { FindSolicitudTitularSocio } from "../../application/services/FindSolicitudTitularSocio";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { assertWorkflowFinancialReady } from "./WorkflowFinancialGuard";

export class CompleteSellerReview {
  constructor(
    private readonly db: DbClient,
    private readonly updates: Pick<UpdateSolicitudUseCase, "prepare">,
    private readonly socios: SocioRepository,
    private readonly verifyLoan = assertWorkflowFinancialReady,
  ) {}

  async execute(input: ChangeSolicitudStateInput, command: WorkflowCommand) {
    const { solicitudId: id, currentUser } = input;
    const prepared = input.changes
      ? await this.updates.prepare({ ...input.changes, id, currentUser }, input.expectedUpdatedAt)
      : null;

    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.solicitud.findUnique({ where: { id }, include: { estadoActual: true, titular: true } });
      if (!current) throw new SolicitudCoreNotFoundError();
      if (!input.expectedUpdatedAt || current.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt))
        throw new AdministrativeCorrectionError("La solicitud cambió. Actualizá la ficha antes de finalizar la revisión.");
      if (!currentUser.isSystemAdmin && current.estadoActual.ownerId !== currentUser.workflowOwnerId)
        throw new ForbiddenSolicitudAccessError();
      if (current.archivedAt || current.estadoActual.code !== "Liquidada" || !current.sellerReviewStartedAt)
        throw new AdministrativeCorrectionError("La solicitud ya no está pendiente de revisión de datos.");

      if (prepared) {
        await new SolicitudesCorePrismaDatasource(this.db).update(id, prepared.patch, {
          ...prepared.guard, sellerReviewActor: "seller",
        }, tx);
      }
      const reviewed = prepared
        ? await tx.solicitud.findUniqueOrThrow({ where: { id }, include: { titular: true } })
        : current;
      if (!readSellerReviewChanges(reviewed.sellerReviewChanges).length) {
        assertAnalysisControl(current, input.actionCode);
        if (!reviewed.titular || !(await new FindSolicitudTitularSocio({ sociosRepository: this.socios }).execute(reviewed.titular)))
          throw new SolicitudTitularSocioRequiredForWorkflowError();
        await this.verifyLoan(tx, id, currentUser.id);
      }
      const engine = new SolicitudWorkflowEngine({
        repository: new SolicitudWorkflowPrismaDatasource(this.db, tx),
        capabilitiesService: new SolicitudWorkflowCapabilitiesService(),
      });
      return engine.execute(command);
    }, { timeout: 60_000 });
  }
}
