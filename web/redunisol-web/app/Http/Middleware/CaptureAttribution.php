<?php

namespace App\Http\Middleware;

use App\Services\AttributionJourney;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class CaptureAttribution
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if (! config('attribution.enabled') || ! $request->isMethod('GET') || $response->getStatusCode() !== 200
            || $request->is('admin*', 'api/*', 'dashboard*', 'settings*', 'login', 'register', 'finalizar*', 'health', 'whatsapp/*')
            || (! str_contains((string) $response->headers->get('Content-Type'), 'text/html') && ! $request->header('X-Inertia'))) {
            return $response;
        }
        try {
            $journey = (new AttributionJourney)->touch($request);
            if ($journey) {
                $response->headers->setCookie(cookie(AttributionJourney::COOKIE, $journey->id, config('attribution.days', 30) * 1440, '/', null, $request->isSecure(), true, false, 'lax'));
            } elseif ($request->query->has('ref')) {
                $response->headers->setCookie(cookie()->forget(AttributionJourney::COOKIE));
            }
            // Origin capture must never be shared by a CDN or a browser's cached navigation.
            $response->headers->set('Cache-Control', 'private, no-store');
        } catch (Throwable) {
            // Losing attribution must not prevent loading the site. No URLs/identifiers in logs.
            logger()->warning('Attribution capture unavailable.');
        }

        return $response;
    }
}
