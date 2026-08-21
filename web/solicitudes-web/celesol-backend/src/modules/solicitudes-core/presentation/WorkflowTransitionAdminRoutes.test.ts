import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WorkflowTransitionAdminRoutes } from "./WorkflowTransitionAdminRoutes";

type RouteLayer = {
  route?: {
    methods: Record<string, boolean>;
    path: string;
  };
};

describe("WorkflowTransitionAdminRoutes", () => {
  it("registers the expected workflow transition admin routes", () => {
    const router = WorkflowTransitionAdminRoutes.create({
      getRuleByState: () => undefined,
      listRules: () => undefined,
      updateRule: () => undefined,
    } as never);

    const routeEntries = (router.stack as RouteLayer[])
      .filter((layer) => layer.route)
      .map((layer) => ({
        methods: Object.keys(layer.route!.methods).sort(),
        path: layer.route!.path,
      }));

    assert.deepEqual(routeEntries, [
      { methods: ["get"], path: "/workflow-transitions" },
      { methods: ["get"], path: "/workflow-transitions/:stateCode" },
      { methods: ["put"], path: "/workflow-transitions/:transitionId" },
    ]);
  });
});
