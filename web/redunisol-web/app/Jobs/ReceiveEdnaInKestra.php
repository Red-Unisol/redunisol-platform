<?php

namespace App\Jobs;

use App\Services\EdnaFlowRouter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class ReceiveEdnaInKestra implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 45;

    public function __construct(public readonly int $eventId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            DB::transaction(function (): void {
                $event = DB::table('edna_incoming_events')->where('id', $this->eventId)->lockForUpdate()->first();
                if (! $event || $event->status === 'delivered') {
                    return;
                }
                $url = (string) config('edna.kestra_url');
                if (! config('edna.enabled') || parse_url($url, PHP_URL_SCHEME) !== 'https'
                    || ! parse_url($url, PHP_URL_HOST)) {
                    throw new RuntimeException('Edna receiver is not configured.');
                }
                $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
                $router = new EdnaFlowRouter;
                $context = $router->correlate($event, $payload);
                // Only this trusted bridge can add context; public intake discards it.
                unset($payload['routerContext']);
                if ($context) {
                    $payload['routerContext'] = $context;
                }
                $response = Http::asJson()->acceptJson()->connectTimeout(5)->timeout(25)
                    ->withoutRedirecting()->post($url, $payload);
                $result = $response->json();
                if (! $response->successful() || ! is_array($result) || ($result['ok'] ?? null) !== true
                    || ($result['event_key'] ?? null) !== $event->subject_id.':'.$event->message_id
                    || ! in_array($result['kind'] ?? null, ['router_entry', 'flow_response', 'ignored', 'invalid'], true)) {
                    throw new RuntimeException('Kestra did not acknowledge the Edna event.');
                }
                if ($result['kind'] === 'router_entry') {
                    $router->start($event, $payload);
                } elseif ($context && $result['kind'] === 'flow_response') {
                    if (($result['flow_id_verified'] ?? false) !== true) {
                        throw new RuntimeException('Kestra did not acknowledge verified Flow context.');
                    }
                    $router->complete($event, $context);
                } elseif ($context) {
                    $router->record($event->id, 'invalid_response', $context['send_id']);
                }
                DB::table('edna_incoming_events')->where('id', $this->eventId)->update([
                    'status' => 'delivered', 'outcome' => $result['kind'],
                    'delivered_at' => now(), 'updated_at' => now(),
                ]);
            });
        } catch (Throwable) {
            // Do not chain the original HTTP exception: it may contain the secret webhook URL.
            throw new RuntimeException('Edna event delivery failed; retry using the event ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        DB::table('edna_incoming_events')->where('id', $this->eventId)
            ->where('status', '!=', 'delivered')->update(['status' => 'failed', 'updated_at' => now()]);
    }
}
