<?php

namespace App\Http\Controllers;

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
            if (! $request->isJson() || strlen($request->getContent()) > 1048576) {
                return response('', 400);
            }
            $body = json_decode($request->getContent(), true, 32, JSON_THROW_ON_ERROR);
            $events = is_array($body) && array_key_exists('id', $body) ? [$body] : $body;
            if (! is_array($events) || ! array_is_list($events) || count($events) > 100) {
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
            if ($matched) {
                $headers = [];
                foreach ($request->headers->all() as $name => $values) {
                    if (strlen($name) > 80) {
                        continue;
                    }
                    $value = $values[0] ?? '';
                    $format = $value === '' ? 'empty' : 'raw';
                    if (preg_match('/^(Bearer|Basic)\s+/i', $value, $match)) {
                        $format = strtolower($match[1]);
                    }
                    // Only names and a fixed enumeration: no values, hashes, sizes or body.
                    $headers[$name] = count($values) > 1 ? 'multiple' : $format;
                }
                ksort($headers);
                Cache::put('edna-probe-result:'.$probe, [
                    'observed_at' => now()->toIso8601String(),
                    'headers' => $headers,
                ], max(1, $settings['expires_at'] - now()->timestamp));
            }

            return response()->json(['code' => 'ok']);
        } catch (\JsonException) {
            return response('', 400);
        } catch (Throwable) {
            // Request contents and credentials must never reach exception reporting.
            return response('', 503);
        }
    }
}
