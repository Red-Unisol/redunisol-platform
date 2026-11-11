import assert from "node:assert/strict";
import { it } from "node:test";
import { EvaluateListSolicitudesGateway } from "./EvaluateListSolicitudesGateway";

it("reliquidation requires an explicit known unpaid Core state; cancellation or missing state is not proof", async () => {
  for (const [state, expected] of [["Liquidada", "unpaid"], [" A Transferir ", "unpaid"], ["Pagada", "paid"],
    [null, "unknown"], ["Anulada", "unknown"], ["No Pagada", "unknown"], ["Nuevo estado", "unknown"]]) {
    for (const direct of [false, true]) {
      const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async (url, init) => {
        assert.match(String(url), /EvaluateObj$/);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.tipo, direct ? "F.Module.Cuentas.Prestamos.Prestamo" : "PreSolicitud.Module.Solicitud");
        assert.equal(body.campos, direct ? "Solicitud.Estado.Descripcion" : "Estado.Descripcion");
        return { ok: true, json: async () => [state] };
      });
      assert.equal(await gateway.getReliquidationTransferState("123", direct), expected);
    }
  }
});
