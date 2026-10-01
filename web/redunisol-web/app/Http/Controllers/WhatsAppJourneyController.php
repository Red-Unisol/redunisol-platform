<?php

namespace App\Http\Controllers;

use App\Services\AttributionJourney;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

class WhatsAppJourneyController
{
    public function __invoke(Request $request)
    {
        $input = $request->validate([
            'phone' => ['required', 'regex:/^[0-9]{10,15}$/D'],
            'text' => ['nullable', 'string', 'max:2048'],
        ]);
        $text = $input['text'] ?? '';
        if (config('attribution.enabled')) {
            try {
                $journey = RateLimiter::attempt(
                    'attribution-handoff:'.hash('sha256', (string) $request->ip()), 60,
                    function () use ($request) {
                        $service = new AttributionJourney;
                        $previous = $service->find($request->cookie(AttributionJourney::COOKIE));
                        $snapshot = $previous ? $service->snapshot($previous) : [
                            'version' => 1, 'first' => [], 'last' => [],
                        ];

                        // Each handoff is independent; never rebind an older conversation.
                        return $service->create($snapshot);
                    }, 60);
                // Rate limiting affects recording only; contact always remains available.
                if ($journey) {
                    $text = preg_replace('/\s*\(ref:\s*[a-f0-9]{24}\)/i', '', $text).' (ref: '.$journey->id.')';
                }
            } catch (Throwable) {
                logger()->warning('WhatsApp attribution unavailable; continuing without reference.');
            }
        }

        return redirect()->away('https://wa.me/'.$input['phone'].'?'.http_build_query(['text' => $text], '', '&', PHP_QUERY_RFC3986))
            ->header('Cache-Control', 'private, no-store')->header('Referrer-Policy', 'no-referrer');
    }
}
