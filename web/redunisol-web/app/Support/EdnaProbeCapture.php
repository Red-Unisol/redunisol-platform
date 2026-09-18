<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;

class EdnaProbeCapture
{
    public const MAX_EVENTS = 20;

    public const MAX_BODY_BYTES = 65536;

    public static function headers(Request $request): array
    {
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
            $headers[$name] = count($values) > 1 ? 'multiple' : $format;
        }
        ksort($headers);

        return $headers;
    }

    public static function record(string $id, Request $request, string $outcome): void
    {
        Cache::lock('edna-probe-lock:'.$id, 5)->block(2, function () use ($id, $request, $outcome) {
            // Recheck under the lock so stop and expiry cannot resurrect captures.
            $settings = Cache::get('edna-probe:'.$id);
            if (! is_array($settings) || min($settings['expires_at'], $settings['capture_until'] ?? 0) <= now()->timestamp) {
                return;
            }
            $captures = Cache::get('edna-probe-captures:'.$id, []);
            if (count($captures) >= self::MAX_EVENTS) {
                return;
            }
            $body = $request->getContent();
            $captures[] = [
                'observed_at' => now()->toIso8601String(),
                'outcome' => $outcome,
                'is_json' => $request->isJson(),
                'body_bytes' => strlen($body),
                'truncated' => strlen($body) > self::MAX_BODY_BYTES,
                'headers' => self::headers($request),
                'encrypted_body' => Crypt::encryptString(substr($body, 0, self::MAX_BODY_BYTES)),
            ];
            Cache::put('edna-probe-captures:'.$id, $captures, $settings['expires_at'] - now()->timestamp);
        });
    }
}
