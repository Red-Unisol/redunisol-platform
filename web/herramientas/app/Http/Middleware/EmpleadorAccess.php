<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** La consulta de empleador pide haber entrado con el usuario de Vimarx, para saber quién consulta. */
class EmpleadorAccess
{
    public const SESSION_KEY = 'empleador_usuario';

    public static function usuario(Request $request): ?string
    {
        $usuario = $request->session()->get(self::SESSION_KEY);

        return is_string($usuario) && $usuario !== '' ? $usuario : null;
    }

    public function handle(Request $request, Closure $next)
    {
        if (self::usuario($request) === null) {
            return response()->json(['message' => 'Ingresá con tu usuario de Vimarx para consultar.', 'error' => 'login_required'], 401)
                ->header('Cache-Control', 'no-store, private');
        }

        return $next($request);
    }
}
