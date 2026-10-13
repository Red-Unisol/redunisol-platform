import { randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import type { PrismaClient, ImpersonationSession } from "@prisma/client";
import type { AuthRepository } from "../domain/repositories/AuthRepository";
import type { AccessTokenService } from "../domain/services/AccessTokenService";
import type { RefreshTokenRepository } from "../domain/repositories/RefreshTokenRepository";
import type { RefreshTokenService } from "../domain/services/RefreshTokenService";
import { isRefreshTokenActive } from "../domain/entities/RefreshToken.entity";
import type { AuthUser } from "../domain/entities/User.entity";
import { actingContext } from "./context";

const COOKIE = "actingSession";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode: status });
}
function label(user: AuthUser) {
  return `${[user.firstName, user.lastName].filter(Boolean).join(" ")} (${user.email})`;
}
export class Impersonation {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      users: AuthRepository;
      accessTokens: AccessTokenService;
      refreshTokens: RefreshTokenRepository;
      refreshService: RefreshTokenService;
      secure: boolean;
      origin: string;
    },
  ) {}
  private cookieOptions = () => ({
    httpOnly: true,
    secure: this.deps.secure,
    sameSite: "lax" as const,
    path: "/",
  });
  private async realUser(
    req: Request,
    allowRefresh = false,
    requireAdmin = true,
  ) {
    let userId: string | undefined;
    try {
      userId = this.deps.accessTokens.verify(req.cookies?.accessToken).userId;
    } catch {
      if (!allowRefresh) fail(401, "Sesión inválida.");
    }
    if (!userId && allowRefresh) {
      const raw = req.cookies?.refreshToken;
      if (!raw) fail(401, "Sesión inválida.");
      const token = await this.deps.refreshTokens.findByHash(
        this.deps.refreshService.hash(raw),
      );
      if (!token || !isRefreshTokenActive(token, new Date()))
        fail(401, "Sesión inválida.");
      userId = token.userId;
    }
    const user = userId
      ? await (requireAdmin
          ? this.deps.users.findActiveById(userId)
          : this.deps.users.findById(userId))
      : null;
    if (!user || (requireAdmin && !user.isSystemAdmin))
      fail(
        403,
        "Solo administradores de sistemas pueden ingresar como otro usuario.",
      );
    return user;
  }
  private async session(req: Request, administrator: AuthUser) {
    const id = req.cookies?.[COOKIE];
    if (!id || !uuid.test(id))
      fail(409, "No hay un acceso válido a otro usuario.");
    const session = await this.deps.prisma.impersonationSession.findUnique({
      where: { id },
    });
    if (!session || session.administratorId !== administrator.id)
      fail(403, "Contexto de acceso inválido.");
    return session;
  }
  private async finish(session: ImpersonationSession, reason: string) {
    await this.deps.prisma.$transaction(async (tx) => {
      const ended = await tx.impersonationSession.updateMany({
        where: { id: session.id, endedAt: null },
        data: { endedAt: new Date(), endReason: reason },
      });
      if (ended.count)
        await tx.impersonationOperation.create({
          data: {
            sessionId: session.id,
            administratorId: session.administratorId,
            selectedUserId: session.selectedUserId,
            action: `END:${reason}`,
            statusCode: 200,
            completedAt: new Date(),
          },
        });
    });
  }
  private checkOrigin(req: Request) {
    if (req.headers.origin && req.headers.origin !== this.deps.origin)
      fail(403, "Origen no permitido.");
  }
  router() {
    const router = Router();
    router.get("/", async (req, res, next) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        if (!req.cookies?.[COOKIE]) {
          res.json({ context: null });
          return;
        }
        const admin = await this.realUser(req, true);
        const session = await this.session(req, admin);
        res.json({
          context: {
            sessionId: session.id,
            administrator: { id: admin.id, label: label(admin) },
            selectedUser: {
              id: session.selectedUserId,
              label: session.selectedUserLabel,
            },
            active: !session.endedAt && session.expiresAt > new Date(),
          },
        });
      } catch (error) {
        next(error);
      }
    });
    router.post("/start", async (req, res, next) => {
      try {
        this.checkOrigin(req);
        const admin = await this.realUser(req);
        if (req.cookies?.[COOKIE])
          fail(
            409,
            "Volvé a tu usuario administrador antes de ingresar a otra persona.",
          );
        const userId = req.body?.userId;
        if (typeof userId !== "string" || !uuid.test(userId))
          fail(400, "Usuario inválido.");
        if (userId === admin.id)
          fail(400, "Ya estás en tu usuario administrador.");
        const target = await this.deps.users.findById(userId);
        if (!target || target.state !== 1 || !target.workflowOwnerId)
          fail(
            400,
            "Solo se puede ingresar a usuarios activos con área asignada.",
          );
        const rawRefresh = req.cookies?.refreshToken;
        const refresh = rawRefresh
          ? await this.deps.refreshTokens.findByHash(
              this.deps.refreshService.hash(rawRefresh),
            )
          : null;
        if (
          !refresh ||
          refresh.userId !== admin.id ||
          !isRefreshTokenActive(refresh, new Date())
        )
          fail(401, "Sesión inválida.");
        const session = await this.deps.prisma.$transaction(async (tx) => {
          const created = await tx.impersonationSession.create({
            data: {
              administratorId: admin.id,
              selectedUserId: target.id,
              administratorLabel: label(admin),
              selectedUserLabel: label(target),
              expiresAt: refresh.expiresAt,
            },
          });
          await tx.impersonationOperation.create({
            data: {
              sessionId: created.id,
              administratorId: admin.id,
              selectedUserId: target.id,
              action: "START",
              completedAt: new Date(),
              statusCode: 200,
            },
          });
          return created;
        });
        // Keep the marker for the browser session. Expiry is enforced server-side:
        // dropping this cookie on a timer could silently restore admin permissions
        // while an already-open page still displays the selected user's identity.
        res.cookie(COOKIE, session.id, this.cookieOptions());
        res.setHeader("Cache-Control", "no-store");
        res.json({ user: target });
      } catch (error) {
        next(error);
      }
    });
    router.post("/stop", async (req, res, next) => {
      try {
        this.checkOrigin(req);
        const admin = await this.realUser(req, true);
        const session = await this.session(req, admin);
        await this.finish(session, "RETURN");
        res.clearCookie(COOKIE, this.cookieOptions());
        res.setHeader("Cache-Control", "no-store");
        res.json({ user: admin });
      } catch (error) {
        next(error);
      }
    });
    return router;
  }
  middleware: RequestHandler = async (req, res, next) => {
    if (!req.cookies?.[COOKIE]) {
      next();
      return;
    }
    try {
      const isLogout = req.path === "/auth/logout";
      const admin = await this.realUser(
        req,
        isLogout || req.path === "/auth/refresh",
        !isLogout,
      );
      const session = await this.session(req, admin);
      if (req.path === "/auth/refresh") {
        const raw = req.cookies?.refreshToken;
        const refresh = raw
          ? await this.deps.refreshTokens.findByHash(
              this.deps.refreshService.hash(raw),
            )
          : null;
        if (
          !refresh ||
          refresh.userId !== admin.id ||
          !isRefreshTokenActive(refresh, new Date())
        )
          fail(401, "Sesión inválida.");
      }
      if (isLogout) {
        await this.finish(session, "LOGOUT");
        res.clearCookie(COOKIE, this.cookieOptions());
        next();
        return;
      }
      if (session.endedAt || session.expiresAt <= new Date()) {
        if (!session.endedAt) await this.finish(session, "EXPIRED");
        fail(409, "El acceso finalizó. Volvé a tu usuario administrador.");
      }
      const selectedUser = await this.deps.users.findById(
        session.selectedUserId,
      );
      if (
        !selectedUser ||
        selectedUser.state !== 1 ||
        !selectedUser.workflowOwnerId
      )
        fail(
          403,
          "El usuario seleccionado ya no está activo con área asignada. Volvé a tu usuario administrador.",
        );
      // Login must not replace the original administrator while this mode is active.
      if (req.path === "/auth/login")
        fail(
          409,
          "Volvé a tu usuario administrador antes de iniciar otra sesión.",
        );
      const auditId = randomUUID();
      // Persist the attempt before executing; an interrupted response remains an attempt,
      // never an operation falsely marked successful. No request bodies/tokens are logged.
      await this.deps.prisma.impersonationOperation.create({
        data: {
          id: auditId,
          sessionId: session.id,
          administratorId: admin.id,
          selectedUserId: selectedUser.id,
          action: `${req.method} ${req.path}`,
        },
      });
      let recorded = false;
      const record = () => {
        if (recorded) return;
        recorded = true;
        void this.deps.prisma.impersonationOperation
          .update({
            where: { id: auditId },
            data: {
              completedAt: new Date(),
              statusCode: res.writableFinished ? res.statusCode : 499,
            },
          })
          .catch(() =>
            console.error(
              "No se pudo completar el registro de operación",
              auditId,
            ),
          );
      };
      res.once("finish", record);
      res.once("close", record);
      actingContext.run(
        { sessionId: session.id, administrator: admin, selectedUser, auditId },
        next,
      );
    } catch (error) {
      if (req.path === "/auth/logout") {
        res.clearCookie(COOKIE, this.cookieOptions());
        next();
      } else next(error);
    }
  };
}
