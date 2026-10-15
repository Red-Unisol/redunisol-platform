<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class EdnaOutOfHoursPolicy
{
    public const VERSION = 'sales-out-of-hours-v1';

    public function decide(object $event, array $payload, array $settings, ?array $context = null): array
    {
        return $this->call([
            'action' => $context === null ? 'screen' : 'evaluate',
            'event_key' => $event->subject_id.':'.$event->message_id,
            'received_at' => $payload['receivedAt'], 'now' => now()->toIso8601String(),
            'candidate' => (bool) $event->out_of_hours_candidate,
            'transport_ready' => (new EdnaOutOfHours)->transportReady($event, $payload, $settings),
            'automatic_route' => (new EdnaOutOfHours)->automaticRoute($event, $payload),
            // Customer names, phone numbers and incoming text never enter the policy request.
            'context' => $context === null ? null : ['evidence' => $context['evidence']],
            'settings' => $settings,
        ]);
    }

    public function calendar(array $instants, array $settings): array
    {
        $items = [];
        foreach (array_chunk($instants, 500) as $chunk) {
            $result = $this->call(['action' => 'calendar', 'instants' => $chunk, 'settings' => $settings]);
            $rows = json_decode($result['calendar'], true, 16, JSON_THROW_ON_ERROR);
            if ($result['decision'] !== 'calendar' || ! is_array($rows) || count($rows) !== count($chunk)) {
                throw new RuntimeException('Invalid Kestra calendar acknowledgement.');
            }
            $items = array_merge($items, $rows);
        }

        return $items;
    }

    public function window(array $result): ?array
    {
        if (! in_array($result['decision'], ['context_required', 'send'], true)) {
            return null;
        }
        $start = CarbonImmutable::parse($result['window_start']);
        $end = CarbonImmutable::parse($result['window_end']);
        if (! $start->lt($end) || ! $end->gt(now())) {
            throw new RuntimeException('Expired Kestra policy acknowledgement.');
        }

        return ['start' => $start, 'end' => $end,
            'requirements' => json_decode($result['context_requirements'], true, 16, JSON_THROW_ON_ERROR)];
    }

    private function call(array $input): array
    {
        $request = $input + ['operation' => 'out_of_hours', 'request_id' => (string) Str::uuid(),
            'subject_id' => (string) config('edna.subject_id'), 'event_key' => ''];
        $url = (string) config('edna.kestra_url');
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)) {
            throw new RuntimeException('Kestra policy is not configured.');
        }
        try {
            $response = Http::asJson()->acceptJson()->connectTimeout(3)->timeout(10)
                ->withoutRedirecting()->post($url, $request);
            $result = $response->json();
            if (! $response->successful() || ! is_array($result) || ($result['ok'] ?? null) !== true
                || ($result['kind'] ?? '') !== 'out_of_hours_policy'
                || ($result['policy_version'] ?? '') !== self::VERSION
                || ($result['request_id'] ?? '') !== $request['request_id']
                || ($result['event_key'] ?? '') !== $request['event_key']
                || ! in_array($result['decision'] ?? '', ['suppress', 'context_required', 'send', 'calendar'], true)) {
                throw new RuntimeException('Invalid policy acknowledgement.');
            }

            return $result;
        } catch (Throwable) {
            // Never chain an HTTP exception: it can include the secret trigger URL.
            throw new RuntimeException('Kestra out of hours policy failed; retry using the event ID.');
        }
    }
}
