import { Router } from "express";
import { z } from "zod";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { ForbiddenSolicitudAccessError } from "../solicitudes-core/domain/solicitudes-core-errors";
import { padronesDocument, type PadronesGateway } from "./PadronesGateway";

export function createPadronesRouter(deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  source: (
    id: string,
    user: AuthUser,
  ) => Promise<{ dni: string | null; cuit: string | null }>;
  gateway: Pick<PadronesGateway, "configured" | "lookup">;
}) {
  const router = Router();
  router.get("/:id/padrones", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    try {
      const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      if (!user.isSystemAdmin && user.workflowOwner?.code === "VENDEDORES")
        throw new ForbiddenSolicitudAccessError();
      const id = z.uuid().safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Solicitud inválida." });
        return;
      }
      const source = await deps.source(id.data, user);
      const document =
        padronesDocument(source.dni) ?? padronesDocument(source.cuit);
      if (!document) {
        res.json({ status: "missing_document" });
        return;
      }
      if (!deps.gateway.configured()) {
        res.json({ status: "not_configured" });
        return;
      }
      try {
        res.json({
          status: "available",
          ...(await deps.gateway.lookup(document)),
        });
      } catch {
        res.json({ status: "unavailable" });
      }
    } catch (error) {
      next(error);
    }
  });
  return router;
}
