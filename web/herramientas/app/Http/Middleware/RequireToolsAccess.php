<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireToolsAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('tools.access.required')) {
            return $next($request);
        }

        if ($request->session()->get((string) config('tools.access.session_key')) === true) {
            return $next($request);
        }

        if (trim((string) config('tools.access.password_hash')) === '') {
            if ($this->wantsJson($request)) {
                return response()->json([
                    'ok' => false,
                    'error' => 'tools_access_not_configured',
                    'message' => 'La clave de acceso a herramientas no esta configurada.',
                ], 503);
            }

            return response()
                ->view('tools-access', ['configurationMissing' => true], 503);
        }

        if ($this->wantsJson($request)) {
            return response()->json([
                'ok' => false,
                'error' => 'tools_access_required',
                'message' => 'Debe ingresar la clave de acceso a herramientas.',
            ], 401);
        }

        return redirect()->guest(route('tools.access.show'));
    }

    private function wantsJson(Request $request): bool
    {
        return $request->expectsJson() || $request->is('api/*');
    }
}
