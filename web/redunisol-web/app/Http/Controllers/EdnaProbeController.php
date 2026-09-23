<?php

namespace App\Http\Controllers;

use App\Support\EdnaProbeCapture;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class EdnaProbeController extends Controller
{
    public function __invoke(Request $request, string $probe): Response
    {
        try {
            $settings = Cache::get('edna-probe:'.$probe);
            if (! is_array($settings) || $settings['expires_at'] <= now()->timestamp) {
                return response('', 404);
            }
            if ($request->isMethod('HEAD')) {
                return response('', 200);
            }
            if (! $request->isJson()) {
                $this->capture($settings, $probe, $request, 'not_json');

                return response('', 400);
            }
            if (strlen($request->getContent()) > 1048576) {
                $this->capture($settings, $probe, $request, 'too_large');

                return response('', 400);
            }
            try {
                $body = json_decode($request->getContent(), true, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $this->capture($settings, $probe, $request, 'invalid_json');

                return response('', 400);
            }
            $events = is_array($body) && array_key_exists('id', $body) ? [$body] : $body;
            if (! is_array($events) || ! array_is_list($events) || count($events) > 100) {
                $this->capture($settings, $probe, $request, 'unexpected_envelope');

                return response('', 400);
            }
            $matched = false;
            foreach ($events as $event) {
                if (! is_array($event)) {
                    continue;
                }
                $subject = $event['subjectId'] ?? null;
                $content = $event['messageContent'] ?? null;
                if ((is_string($subject) || is_int($subject)) && (string) $subject === $settings['subject_id']
                    && is_array($content) && ($content['type'] ?? null) === 'TEXT'
                    && ($content['text'] ?? null) === $settings['marker']) {
                    $matched = true;
                    break;
                }
            }
            $this->capture($settings, $probe, $request, $matched ? 'matched' : 'no_match');
            if ($matched) {
                Cache::put('edna-probe-result:'.$probe, [
                    'observed_at' => now()->toIso8601String(),
                    'headers' => EdnaProbeCapture::headers($request),
                ], max(1, $settings['expires_at'] - now()->timestamp));
            }

            return response()->json(['code' => 'ok']);
        } catch (Throwable) {
            // Request contents and credentials must never reach exception reporting.
            return response('', 503);
        }
    }

    private function capture(array $settings, string $probe, Request $request, string $outcome): void
    {
        if (($settings['capture_until'] ?? 0) > now()->timestamp) {
            EdnaProbeCapture::record($probe, $request, $outcome);
        }
    }
}
