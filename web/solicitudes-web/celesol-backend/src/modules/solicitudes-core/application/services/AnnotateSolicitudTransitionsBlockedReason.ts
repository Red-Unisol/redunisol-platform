import { EnsureSolicitudHasPrestamoLegacy } from "./EnsureSolicitudHasPrestamoLegacy";
import { EnsureSolicitudTitularHasRequiredDataForConfirmar } from "./EnsureSolicitudTitularHasRequiredDataForConfirmar";
import { EnsureSolicitudTitularSocioExists } from "./EnsureSolicitudTitularSocioExists";
import type { WorkflowTransition } from "../../domain/entities/WorkflowTransition.entity";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import {
  SolicitudPrestamoLegacyRequiredForWorkflowError,
  SolicitudTitularDataIncompleteForConfirmarError,
  SolicitudTitularSocioRequiredForWorkflowError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

const LIQUIDAR_ACTION_CODE = "liquidar";
const CONFIRMAR_ACTION_CODE = "confirmar";

type Dependencies = {
  sociosRepository: SocioRepository;
  solicitudesRepository: SolicitudesCoreRepository;
};

export class AnnotateSolicitudTransitionsBlockedReason {
  private readonly ensureSolicitudHasPrestamoLegacy: EnsureSolicitudHasPrestamoLegacy;
  private readonly ensureSolicitudTitularHasRequiredDataForConfirmar: EnsureSolicitudTitularHasRequiredDataForConfirmar;
  private readonly ensureSolicitudTitularSocioExists: EnsureSolicitudTitularSocioExists;

  constructor(dependencies: Dependencies) {
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
  }

  async execute(
    transitions: WorkflowTransition[],
    solicitudId: string,
  ): Promise<WorkflowTransition[]> {
    const liquidarBlockedReason = await this.resolveLiquidarBlockedReason(
      transitions,
      solicitudId,
    );
    const confirmarBlockedReason = await this.resolveConfirmarBlockedReason(
      transitions,
      solicitudId,
    );

    if (!liquidarBlockedReason && !confirmarBlockedReason) {
      return transitions;
    }

    return transitions.map((transition) => {
      if (
        transition.actionCode === LIQUIDAR_ACTION_CODE &&
        liquidarBlockedReason
      ) {
        return { ...transition, blockedReason: liquidarBlockedReason };
      }

      if (
        transition.actionCode === CONFIRMAR_ACTION_CODE &&
        confirmarBlockedReason
      ) {
        return { ...transition, blockedReason: confirmarBlockedReason };
      }

      return transition;
    });
  }

  private async resolveLiquidarBlockedReason(
    transitions: WorkflowTransition[],
    solicitudId: string,
  ): Promise<string | null> {
    const hasLiquidarTransition = transitions.some(
      (transition) => transition.actionCode === LIQUIDAR_ACTION_CODE,
    );

    if (!hasLiquidarTransition) {
      return null;
    }

    const titularHasSocio =
      await this.ensureSolicitudTitularSocioExists.check(solicitudId);

    if (!titularHasSocio) {
      return new SolicitudTitularSocioRequiredForWorkflowError().message;
    }

    const hasPrestamoLegacy =
      await this.ensureSolicitudHasPrestamoLegacy.check(solicitudId);

    return hasPrestamoLegacy
      ? null
      : new SolicitudPrestamoLegacyRequiredForWorkflowError().message;
  }

  private async resolveConfirmarBlockedReason(
    transitions: WorkflowTransition[],
    solicitudId: string,
  ): Promise<string | null> {
    const hasConfirmarTransition = transitions.some(
      (transition) => transition.actionCode === CONFIRMAR_ACTION_CODE,
    );

    if (!hasConfirmarTransition) {
      return null;
    }

    const { isComplete, missingLabels } =
      await this.ensureSolicitudTitularHasRequiredDataForConfirmar.check(
        solicitudId,
      );

    return isComplete
      ? null
      : new SolicitudTitularDataIncompleteForConfirmarError(missingLabels)
          .message;
  }
}
