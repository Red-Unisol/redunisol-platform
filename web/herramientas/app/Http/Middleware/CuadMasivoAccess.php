<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** Acceso con la contraseña propia de la consulta CUAD masiva (no la de Análisis). */
class CuadMasivoAccess
{
    public static function authenticated(Request $request): bool
    {
        $hash = (string) config('cuad_masivo.password_hash');

        return $hash !== '' && hash_equals(hash('sha256', $hash), (string) $request->session()->get('cuad_masivo_access', ''));
    }

    public function handle(Request $request, Closure $next)
    {
        if (! config('tools.enabled', true)) {
            $response = response()->json(['message' => 'Esta página no está disponible.'], 503);
        } elseif (! self::authenticated($request)) {
            $response = response()->json(['message' => 'Ingresá la contraseña para continuar.'], 401);
        } else {
            $response = $next($request);
        }

        // Las descargas son BinaryFileResponse, sin el helper header() de Laravel.
        $response->headers->set('Cache-Control', 'no-store, private');

        return $response;
    }
}
