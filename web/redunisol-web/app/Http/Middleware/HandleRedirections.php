<?php

namespace App\Http\Middleware;

use App\Models\Redirection;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class HandleRedirections
{
    /**
     * Tiempo de caché de las redirecciones (en segundos).
     * Se invalida automáticamente al guardar desde Filament.
     */
    private const CACHE_TTL = 300;

    private const CACHE_KEY = 'site_redirections';

    public function handle(Request $request, Closure $next): Response
    {
        // Solo aplica a peticiones GET/HEAD que no son de Filament ni assets.
        if (! $request->isMethod('GET') && ! $request->isMethod('HEAD')) {
            return $next($request);
        }

        $path = '/'.ltrim($request->path(), '/');

        // These reviewed migration rules take precedence over editable CMS rules.
        $managed = config('redirects', []);
        if (isset($managed[$path])) {
            $target = $managed[$path];
            if ($query = $request->getQueryString()) {
                $target .= (str_contains($target, '?') ? '&' : '?').$query;
            }

            return redirect()->to($target, 301);
        }

        $redirections = Cache::remember(self::CACHE_KEY, self::CACHE_TTL, function () {
            return Redirection::where('is_active', true)
                ->get(['from', 'to', 'is_external'])
                ->keyBy('from');
        });

        if ($redirections->has($path)) {
            $rule = $redirections->get($path);

            return $rule->is_external
                ? redirect()->away($rule->to, 301)
                : redirect()->to($rule->to, 301);
        }

        return $next($request);
    }

    /**
     * Invalida la caché de redirecciones.
     * Llamar desde el Resource al guardar / borrar.
     */
    public static function clearCache(): void
    {
        Cache::forget(self::CACHE_KEY);
    }
}
