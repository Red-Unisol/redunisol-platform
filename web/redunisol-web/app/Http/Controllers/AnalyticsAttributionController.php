<?php

namespace App\Http\Controllers;

use App\Services\AttributionJourney;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class AnalyticsAttributionController
{
    public function __invoke(Request $request): Response
    {
        if (! config('attribution.enabled')) {
            return response()->noContent();
        }

        // This cookie-authenticated bridge only accepts commands from this site.
        $origin = $request->header('Origin');
        abort_if($origin !== null && $origin !== $request->getSchemeAndHttpHost(), 403);

        $input = $request->validate([
            'ga_client_id' => ['required', 'string', 'regex:/^[0-9]{1,20}\.[0-9]{1,20}$/D'],
            'ga_session_id' => ['nullable', 'string', 'regex:/^[0-9]{1,20}$/D'],
        ]);

        try {
            // The browser cannot select a reference or submit an attribution snapshot.
            (new AttributionJourney)->recordAnalytics(
                $request->cookie(AttributionJourney::COOKIE), $input,
            );
        } catch (Throwable) {
            logger()->warning('Analytics attribution unavailable.');
        }

        return response()->noContent();
    }
}
