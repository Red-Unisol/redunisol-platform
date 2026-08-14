import { Router } from "express";
import type { WorkflowTransitionAdminController } from "./WorkflowTransitionAdminController";

export class WorkflowTransitionAdminRoutes {
  static create(controller: WorkflowTransitionAdminController) {
    const router = Router();

    router.get("/workflow-transitions", controller.listRules);
    router.get("/workflow-transitions/:stateCode", controller.getRuleByState);
    router.put("/workflow-transitions/:transitionId", controller.updateRule);

    return router;
  }
}
