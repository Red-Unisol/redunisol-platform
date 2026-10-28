import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import type { PrismaClient } from "@prisma/client";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { DocumentReviewError } from "../document-review/domain";

export function createNotificationsRouter(auth: Pick<GetCurrentUserUseCase, "execute">, db: Pick<PrismaClient, "beexNotification"> = prisma) {
  const router = Router();
  router.use(async (req, res, next) => {
    try {
      res.locals.notificationUser = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      res.setHeader("Cache-Control", "no-store");
      next();
    } catch (e) { next(e); }
  });
  router.get("/", async (req, res, next) => {
    try {
      const recipientId = res.locals.notificationUser.id as string;
      const unreadOnly = req.query.unreadOnly === "true" || req.query.unreadOnly === "1";
      const query = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
      if (!query.success) throw new DocumentReviewError("Paginación inválida.", 400);
      const { offset, limit } = query.data;
      const where = { recipientId, ...(unreadOnly ? { readAt: null } : {}) };
      const [items, unreadCount, total] = await Promise.all([
        db.beexNotification.findMany({ where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset,
          select: { id: true, title: true, body: true, solicitudId: true, loanId: true, kind: true, createdAt: true, readAt: true } }),
        db.beexNotification.count({ where: { recipientId, readAt: null } }),
        db.beexNotification.count({ where }),
      ]);
      res.json({ items, unreadCount, total, offset, limit });
    } catch (e) { next(e); }
  });
  router.post("/read-all", async (_req, res, next) => {
    try {
      await db.beexNotification.updateMany({ where: { recipientId: res.locals.notificationUser.id, readAt: null }, data: { readAt: new Date() } });
      res.status(204).end();
    } catch (e) { next(e); }
  });
  router.post("/:id/read", async (req, res, next) => {
    try {
      const parsed = z.uuid().safeParse(req.params.id);
      if (!parsed.success) throw new DocumentReviewError("Notificación inválida.", 400);
      await db.beexNotification.updateMany({ where: { id: parsed.data, recipientId: res.locals.notificationUser.id, readAt: null }, data: { readAt: new Date() } });
      res.status(204).end();
    } catch (e) { next(e); }
  });
  return router;
}
