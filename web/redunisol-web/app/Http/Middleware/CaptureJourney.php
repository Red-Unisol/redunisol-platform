<?php

namespace App\Http\Middleware;

use App\Services\JourneyLedger;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class CaptureJourney
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('journey.enabled') || ! $request->isMethod('GET')
            || $request->is('admin*', 'api/*', 'dashboard*', 'settings*', 'login', 'register', 'health', 'up')) {
            return $next($request);
        }
        $context = [];
        foreach (JourneyLedger::COOKIES as $index => $cookie) {
            $value = $request->cookie($cookie);
            $context[$index === 0 ? 'visitor_id' : 'session_id'] = is_string($value) && Str::isUuid($value) ? $value : (string) Str::uuid();
        }
        $request->attributes->set('journey_context', $context);
        $response = $next($request);
        if (str_contains((string) $response->headers->get('Content-Type'), 'text/html') || $request->header('X-Inertia') || $request->is('whatsapp/start')) {
            foreach (JourneyLedger::COOKIES as $index => $cookie) {
                $response->headers->setCookie(cookie($cookie, $context[$index === 0 ? 'visitor_id' : 'session_id'], $index === 0 ? 43200 : 30, '/', null, $request->isSecure(), true, false, 'lax'));
            }
            $response->headers->set('Cache-Control', 'private, no-store');
            app(JourneyLedger::class)->record('page.request', [
                'url' => JourneyLedger::url($request->fullUrl()),
                'referrer' => JourneyLedger::url((string) $request->header('referer')),
                'user_agent' => Str::limit((string) $request->userAgent(), 512, ''),
                'status' => $response->getStatusCode(),
            ]);
        }

        return $response;
    }
}
