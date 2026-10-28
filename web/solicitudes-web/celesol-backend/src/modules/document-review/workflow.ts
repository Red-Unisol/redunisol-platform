import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { ChangeSolicitudStateUseCase } from "../solicitudes-core/application/use-cases/ChangeSolicitudState.use-case";
import { SolicitudWorkflowEngine } from "../solicitudes-core/domain/workflow/SolicitudWorkflowEngine";
import { SolicitudWorkflowPrismaDatasource } from "../solicitudes-core/infrastructure/datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudWorkflowRepositoryImpl } from "../solicitudes-core/infrastructure/repositories/SolicitudWorkflowRepositoryImpl";
import { SolicitudesCorePrismaDatasource } from "../solicitudes-core/infrastructure/datasources/SolicitudesCorePrismaDatasource";
import { SolicitudesCoreRepositoryImpl } from "../solicitudes-core/infrastructure/repositories/SolicitudesCoreRepositoryImpl";
import { SolicitudAdjuntosPrismaDatasource } from "../solicitudes-core/adjuntos/infrastructure/datasources/SolicitudAdjuntosPrismaDatasource";
import { SolicitudAdjuntoRepositoryImpl } from "../solicitudes-core/adjuntos/infrastructure/repositories/SolicitudAdjuntoRepositoryImpl";
import { SociosPrismaDatasource } from "../socios/infrastructure/datasources/SociosPrismaDatasource";
import { SocioRepositoryImpl } from "../socios/infrastructure/repositories/SocioRepositoryImpl";
import { DocumentReviewError } from "./domain";
import { assertWorkflowFinancialReady } from "../solicitudes-core/infrastructure/services/WorkflowFinancialGuard";
import { administrativeSource } from "../solicitudes-core/infrastructure/services/AdministrativeCorrectionService";
import { assertCoreReconciled, coreConditionsFingerprint } from "../solicitudes-core/domain/workflow/AdministrativeCorrection";
import type { SignatureFinancialProof } from "./DocumentReviewService";

export function createDocumentReviewWorkflow(db: PrismaClient, dependencies: {
  financialGuard?: typeof assertWorkflowFinancialReady;
} = {}) {
  const solicitudesRepository = new SolicitudesCoreRepositoryImpl(
    new SolicitudesCorePrismaDatasource(db),
  );
  const adjuntoRepository = new SolicitudAdjuntoRepositoryImpl(
    new SolicitudAdjuntosPrismaDatasource(db),
  );
  const sociosRepository = new SocioRepositoryImpl(
    new SociosPrismaDatasource(db),
  );
  return async (
    tx: Prisma.TransactionClient,
    solicitudId: string,
    user: AuthUser,
    decisionId: string,
    action: "transferir" | "devolver_a_liquidada",
    comment: string,
    financialProof?: SignatureFinancialProof,
  ) => {
    const repository = new SolicitudWorkflowRepositoryImpl(
      new SolicitudWorkflowPrismaDatasource(db, tx),
    );
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository,
      sociosRepository,
      solicitudesRepository,
      now: () => new Date(),
      authorizeFinancialOperation: async () => {
        if (!financialProof) return (dependencies.financialGuard ?? assertWorkflowFinancialReady)(tx, solicitudId, user.id);
        const current = await administrativeSource(tx, solicitudId);
        assertCoreReconciled(current, action);
        if (current.legacyOid !== financialProof.loanId || coreConditionsFingerprint(current) !== financialProof.conditionsFingerprint)
          throw new DocumentReviewError("El préstamo o sus condiciones cambiaron después de la comprobación financiera. Actualizá la revisión.");
      },
      engine: new SolicitudWorkflowEngine({ repository }),
      authorizeDocumentReview: async () => {
        const approval = await tx.solicitudDocumentDecision.findFirst({
          where: {
            id: decisionId,
            decidedBy: user.id,
            humanDecision: action === "transferir" ? "approve" : "not_approve",
            ...(action === "transferir"
              ? { legajoAdjuntoId: { not: null } }
              : {}),
            review: { solicitudId },
          },
        });
        if (!approval)
          throw new DocumentReviewError(
            "Se requiere una decisión humana registrada para ejecutar esta acción.",
          );
      },
    });
    await useCase.execute({
      solicitudId,
      actionCode: action,
      comment,
      currentUser: {
        id: user.id,
        workflowOwnerId: user.workflowOwnerId ?? "",
        isSystemAdmin: user.isSystemAdmin,
      },
    });
  };
}
