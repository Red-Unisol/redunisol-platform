import { Router } from "express";
import type { FieldAccessAdminController } from "./FieldAccessAdminController";

export class FieldAccessAdminRoutes {
  static create(controller: FieldAccessAdminController) {
    const router = Router();

    router.get("/field-access-rules", controller.listRules);
    router.get("/field-access-rules/:stateCode", controller.getRuleByState);
    router.put("/field-access-rules/:stateCode", controller.updateRule);
    router.get("/field-access-fields", controller.getFieldCatalog);

    return router;
  }
}
