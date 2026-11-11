<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class PadronesServiceAccess
{
    public function handle(Request $request, Closure $next)
    {
        $token = (string) config('padrones.service_token');
        if (! config('tools.enabled', true) || strlen($token) < 32) {
            $response = response()->json(['message' => 'La consulta de padrones no está configurada.'], 503);
        } elseif (! hash_equals($token, (string) $request->bearerToken())) {
            $response = response()->json(['message' => 'Acceso no autorizado.'], 401);
        } else {
            $response = $next($request);
        }

        $response->headers->set('Cache-Control', 'no-store, private');

        return $response;
    }
}
