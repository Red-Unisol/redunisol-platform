import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FieldAccessAdminRoutes } from "./FieldAccessAdminRoutes";

type RouteLayer = {
  route?: {
    methods: Record<string, boolean>;
    path: string;
  };
};

describe("FieldAccessAdminRoutes", () => {
  it("registers the expected admin field-access routes", () => {
    const router = FieldAccessAdminRoutes.create({
      getFieldCatalog: () => undefined,
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
      { methods: ["get"], path: "/field-access-rules" },
      { methods: ["get"], path: "/field-access-rules/:stateCode" },
      { methods: ["put"], path: "/field-access-rules/:stateCode" },
      { methods: ["get"], path: "/field-access-fields" },
    ]);
  });
});
