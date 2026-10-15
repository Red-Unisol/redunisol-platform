import type { NextFunction, Request, Response } from "express";

import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { SolicitudesCoreRepository } from "../domain/repositories/SolicitudesCoreRepository";
import { SolicitudCoreNotFoundError } from "../domain/solicitudes-core-errors";
import {
  esUsuarioVendedor,
  type VisibilidadVendedorResolver,
} from "../domain/services/VisibilidadVendedorResolver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Dependencies = {
  getCurrentUserUseCase: Pick<GetCurrentUserUseCase, "execute">;
  repository: Required<Pick<SolicitudesCoreRepository, "findCreadorById">>;
  visibilidadVendedorResolver: VisibilidadVendedorResolver;
};

type CookieRequest = Request<{ id?: string }> & {
  cookies?: Record<string, string | undefined>;
};

/**
 * Control a la entrada de toda ruta de una solicitud (/:id y lo que cuelga:
 * adjuntos, cancelaciones, historial, transiciones...). Un vendedor solo
 * entra a las suyas o, si es dueño de un agente, a las de sus vendedores.
 *
 * Responde 404 y no 403 para no confirmar que la solicitud existe. Las
 * rutas que no son de una solicitud (/stats, /simulacion...) pasan de largo:
 * no tienen un UUID en el lugar del id.
 */
export function crearVisibilidadVendedorGuard(dependencies: Dependencies) {
  return async (req: CookieRequest, _res: Response, next: NextFunction) => {
    const solicitudId = req.params.id;

    if (!solicitudId || !UUID_PATTERN.test(solicitudId)) {
      next();
      return;
    }

    try {
      const usuario = await dependencies.getCurrentUserUseCase.execute(
        req.cookies?.[ACCESS_TOKEN_COOKIE],
      );

      if (!esUsuarioVendedor(usuario)) {
        next();
        return;
      }

      const creador =
        await dependencies.repository.findCreadorById(solicitudId);

      // Si no existe, que siga: el endpoint responde su propio 404.
      if (creador === null) {
        next();
        return;
      }

      const visibles =
        await dependencies.visibilidadVendedorResolver.creadoresVisibles(
          usuario,
        );

      if (!visibles.includes(creador)) {
        throw new SolicitudCoreNotFoundError();
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
