<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class AnalisisAccess
{
    public static function authenticated(Request $request): bool
    {
        $hash = (string) config('analisis.password_hash');

        return $hash !== '' && hash_equals(hash('sha256', $hash), (string) $request->session()->get('analisis_access', ''));
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

        return $response->header('Cache-Control', 'no-store, private');
    }
}
