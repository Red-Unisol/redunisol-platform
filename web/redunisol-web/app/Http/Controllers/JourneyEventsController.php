<?php

namespace App\Http\Controllers;

use App\Services\JourneyLedger;
use Illuminate\Http\Request;

class JourneyEventsController
{
    public function __invoke(Request $request, JourneyLedger $ledger)
    {
        abort_unless(config('journey.enabled'), 404);
        abort_if(strlen($request->getContent()) > 49152, 413);
        // This endpoint has no database-backed session or rate limiter.
        $origin = $request->header('Origin');
        abort_unless(is_string($origin) && rtrim($origin, '/') === $request->getSchemeAndHttpHost(), 403);
        $input = $request->validate([
            'events' => 'required|array|min:1|max:20',
            'events.*.event_id' => 'required|uuid',
            'events.*.type' => 'required|in:page.view,link.click,form.step,form.submit,form.result,form.validation,receipt.result,page.leave,tracking.gap',
            'events.*.occurred_at' => 'required|date',
            'events.*.page_id' => 'required|uuid',
            'events.*.url' => 'required|string|max:4096',
            'events.*.referrer' => 'nullable|string|max:4096',
            'events.*.target' => 'nullable|string|max:4096',
            'events.*.step' => 'nullable|integer|min:0|max:20',
            'events.*.result' => 'nullable|string|max:80',
            'events.*.elapsed_ms' => 'nullable|integer|min:0|max:86400000',
            'events.*.dropped_count' => 'nullable|integer|min:0|max:1000000000',
        ]);
        $context = $ledger->context($request);
        abort_unless(isset($context['visitor_id'], $context['session_id']), 422);
        $events = [];
        foreach ($input['events'] as $event) {
            // Client events are evidence from a browser, never CRM identity or server success.
            $data = array_intersect_key($event, array_flip(['url', 'referrer', 'target', 'step', 'result', 'elapsed_ms', 'dropped_count']));
            foreach (['url', 'referrer', 'target'] as $key) {
                if (isset($data[$key])) {
                    $data[$key] = JourneyLedger::url($data[$key]);
                }
            }
            $events[] = $ledger->event($event['type'], $data, $context + ['page_id' => $event['page_id']], 'web.browser', $event['event_id'], $event['occurred_at']);
        }
        try {
            $ledger->append($events);
        } catch (\Throwable) {
            return response()->json(['error' => 'storage_unavailable'], 503);
        }

        return response()->json(['accepted' => count($events)], 202)->header('Cache-Control', 'no-store');
    }
}
