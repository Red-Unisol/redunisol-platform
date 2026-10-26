import type { ArchivarEvaluacionExcel } from "../../../riesgo/application/services/ArchivarEvaluacionExcel";
import type { ChangeSolicitudStateInput } from "../dtos/ChangeSolicitudState.dto";
import { AnnotateSolicitudTransitionsBlockedReason } from "../services/AnnotateSolicitudTransitionsBlockedReason";
import { EnsureSolicitudHasPrestamoLegacy } from "../services/EnsureSolicitudHasPrestamoLegacy";
import { EnsureSolicitudHasReciboSueldoAdjunto } from "../services/EnsureSolicitudHasReciboSueldoAdjunto";
import { EnsureSolicitudTitularHasRequiredDataForConfirmar } from "../services/EnsureSolicitudTitularHasRequiredDataForConfirmar";
import { EnsureSolicitudTitularSocioExists } from "../services/EnsureSolicitudTitularSocioExists";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import type { SolicitudAdjuntoRepository } from "../../adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  archivarEvaluacion?: Pick<ArchivarEvaluacionExcel, "execute">;
  adjuntoRepository: SolicitudAdjuntoRepository;
  engine: SolicitudWorkflowEngine;
  now: () => Date;
  sociosRepository: SocioRepository;
  solicitudesRepository: SolicitudesCoreRepository;
  authorizeDocumentReview?: (input: ChangeSolicitudStateInput) => Promise<void>;
  authorizeFinancialOperation?: (input: ChangeSolicitudStateInput) => Promise<void>;
};

// La transicion "pagar" (Transferir -> Pagada) puede ejecutarla, ademas del
// owner actual, cualquier usuario del owner RIESGO. Necesitamos el codigo de
// owner (no solo el id) para verificarlo en SolicitudTransitionPolicy.
const RIESGO_OWNER_ACTION_EXCEPTIONS = new Set(["pagar", "transferir"]);

export class ChangeSolicitudStateUseCase {
  private readonly archivarEvaluacion?: Pick<ArchivarEvaluacionExcel, "execute">;
  private readonly annotateSolicitudTransitionsBlockedReason: AnnotateSolicitudTransitionsBlockedReason;
  private readonly ensureSolicitudHasReciboSueldoAdjunto: EnsureSolicitudHasReciboSueldoAdjunto;
  private readonly ensureSolicitudHasPrestamoLegacy: EnsureSolicitudHasPrestamoLegacy;
  private readonly ensureSolicitudTitularHasRequiredDataForConfirmar: EnsureSolicitudTitularHasRequiredDataForConfirmar;
  private readonly ensureSolicitudTitularSocioExists: EnsureSolicitudTitularSocioExists;
  private readonly engine: SolicitudWorkflowEngine;
  private readonly now: () => Date;
  private readonly solicitudesRepository: SolicitudesCoreRepository;
  private readonly authorizeDocumentReview?: (input: ChangeSolicitudStateInput) => Promise<void>;
  private readonly authorizeFinancialOperation?: (input: ChangeSolicitudStateInput) => Promise<void>;

  constructor(dependencies: Dependencies) {
    this.archivarEvaluacion = dependencies.archivarEvaluacion;
    this.authorizeDocumentReview = dependencies.authorizeDocumentReview;
    this.authorizeFinancialOperation = dependencies.authorizeFinancialOperation;
    this.solicitudesRepository = dependencies.solicitudesRepository;
    this.annotateSolicitudTransitionsBlockedReason =
      new AnnotateSolicitudTransitionsBlockedReason({
        sociosRepository: dependencies.sociosRepository,
        solicitudesRepository: dependencies.solicitudesRepository,
      });
    this.ensureSolicitudHasReciboSueldoAdjunto = new EnsureSolicitudHasReciboSueldoAdjunto({
      adjuntoRepository: dependencies.adjuntoRepository,
    });
    this.ensureSolicitudHasPrestamoLegacy = new EnsureSolicitudHasPrestamoLegacy({
      solicitudesRepository: dependencies.solicitudesRepository,
    });
    this.ensureSolicitudTitularHasRequiredDataForConfirmar =
      new EnsureSolicitudTitularHasRequiredDataForConfirmar({
        solicitudesRepository: dependencies.solicitudesRepository,
      });
    this.ensureSolicitudTitularSocioExists = new EnsureSolicitudTitularSocioExists({
      sociosRepository: dependencies.sociosRepository,
      solicitudesRepository: dependencies.solicitudesRepository,
    });
    this.engine = dependencies.engine;
    this.now = dependencies.now;
  }

  async execute(input: ChangeSolicitudStateInput) {
    if (["liquidar", "liquidar_con_firma", "transferir", "pagar"].includes(input.actionCode))
      await this.authorizeFinancialOperation?.(input);
    if (["transferir", "devolver_a_liquidada"].includes(input.actionCode)) {
      await this.authorizeDocumentReview?.(input);
    }
    // Architectural guard-rail:
    // Productive workflow state changes must go through this use case and then
    // through SolicitudWorkflowEngine (policy + execution plan).
    // New productive flows should not bypass this by calling repository/datasource
    // methods directly.
    //
    // The titular-socio guard only applies to the "liquidar" action: that is the
    // single actionCode that moves a solicitud out of Confirmada into Liquidada.
    // A solicitud can reach and stay in Confirmada without a socio; it just can't
    // advance to Liquidada until one exists. "confirmar" never requires a socio.
    if (["liquidar", "liquidar_con_firma"].includes(input.actionCode)) {
      await this.ensureSolicitudTitularSocioExists.execute(input.solicitudId);
      await this.ensureSolicitudHasPrestamoLegacy.execute(input.solicitudId);
    }

    // El envío a Riesgo requiere el recibo adjunto, pero no cargar su monto.
    if (input.actionCode === "enviar") {
      await this.ensureSolicitudHasReciboSueldoAdjunto.execute(input.solicitudId);
    }

    // The titular-required-data guard applies to "confirmar" (RevisionRiesgo or
    // PreAprobada -> Confirmada): PreAprobada is the last state where a solicitud
    // can still carry incomplete titular data, so confirming requires the core
    // titular fields (documento, nombre, fecha de nacimiento, contacto, etc.) to
    // be complete.
    if (input.actionCode === "confirmar") {
      await this.ensureSolicitudTitularHasRequiredDataForConfirmar.execute(
        input.solicitudId,
      );
    }

    const workflowOwnerCode =
      !input.currentUser.isSystemAdmin &&
      RIESGO_OWNER_ACTION_EXCEPTIONS.has(input.actionCode) &&
      this.solicitudesRepository.findWorkflowOwnerCodeById
        ? await this.solicitudesRepository.findWorkflowOwnerCodeById(
            input.currentUser.workflowOwnerId,
          )
        : null;

    const result = await this.engine.execute({
      ...(input.administrativeCorrection ? { administrativeCorrection: input.administrativeCorrection } : {}),
      actionCode: input.actionCode,
      changedBy: input.currentUser.id,
      comment: input.comment,
      motivo: input.motivo,
      now: this.now(),
      solicitudId: input.solicitudId,
      workflowOwnerId: input.currentUser.workflowOwnerId,
      ...(workflowOwnerCode ? { workflowOwnerCode } : {}),
      ...(input.currentUser.isSystemAdmin ? { isSystemAdmin: true } : {}),
    }, input.actionCode === "liquidar" && this.archivarEvaluacion
      ? () => this.archivarEvaluacion!.execute({solicitudId: input.solicitudId, actorId: input.currentUser.id, etapa: "liquidacion"})
      : undefined);

    return {
      ...result,
      transitions: await this.annotateSolicitudTransitionsBlockedReason.execute(
        result.transitions,
        input.solicitudId,
      ),
    };
  }
}
