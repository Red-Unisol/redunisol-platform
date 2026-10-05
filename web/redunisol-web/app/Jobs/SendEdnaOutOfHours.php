<?php

namespace App\Jobs;

use App\Models\EdnaOutOfHoursSend;
use App\Services\EdnaApi;
use App\Services\EdnaBitrix;
use App\Services\EdnaOutOfHours;
use App\Support\WhatsAppOutOfHoursSettings;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

class SendEdnaOutOfHours implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 40;

    public function __construct(public readonly int $sendId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $send = EdnaOutOfHoursSend::find($this->sendId);
            if (! $send || in_array($send->state, ['confirmed', 'rejected', 'cancelled', 'expired'], true)) {
                return;
            }
            if ($send->state !== 'pending') {
                Queue::connection('edna')->push(new ReconcileEdnaOutOfHours($send->id), '', 'edna');

                return;
            }
            $event = DB::table('edna_incoming_events')->find($send->event_id);
            $payload = $event && $event->payload ? json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR) : null;
            $settings = (new WhatsAppOutOfHoursSettings)->get();
            $window = $payload ? (new EdnaOutOfHours)->eligible($event, $payload, $settings) : null;
            if (! $window || ! $window['end']->equalTo($send->window_end)) {
                $this->cancel('preflight_changed');

                return;
            }
            $api = new EdnaApi;
            $api->assertCascade($send);
            $line = (new EdnaBitrix)->call('imopenlines.config.get', ['CONFIG_ID' => 1, 'WITH_QUEUE' => 'N']);
            if ((string) ($line['ID'] ?? '') !== '1' || ($line['WORKTIME_DAYOFF_RULE'] ?? '') !== 'none') {
                // Fail closed until the old automatic reply is explicitly disabled.
                throw new RuntimeException('The Bitrix out of hours reply is still active.');
            }
            $claimed = DB::transaction(function () use ($send): bool {
                DB::table('edna_router_contacts')->where('scope', $send->scope)->lockForUpdate()->first();
                $event = DB::table('edna_incoming_events')->find($send->event_id);
                $settings = (new WhatsAppOutOfHoursSettings)->get();
                $payload = $event && $event->payload ? json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR) : null;
                $window = $payload ? (new EdnaOutOfHours)->eligible($event, $payload, $settings) : null;
                if (! $window || ! $window['end']->equalTo($send->window_end)
                    || (string) config('edna.cascade_id') !== $send->cascade_id) {
                    $this->cancel('preflight_changed');

                    return false;
                }
                // Immutable text snapshot is encrypted in the ledger, never in the queued job.
                (new WhatsAppOutOfHoursSettings)->assertText($send->message_text);

                return EdnaOutOfHoursSend::whereKey($send->id)->where('state', 'pending')->update([
                    'state' => 'sending', 'send_started_at' => now(), 'updated_at' => now(),
                ]) === 1;
            });
            if (! $claimed) {
                return;
            }
            $state = 'unknown';
            $reason = 'schedule_uncertain';
            try {
                $response = $api->post('cascade/schedule', [
                    'requestId' => $send->request_id, 'comment' => $send->request_id, 'cascadeId' => $send->cascade_id,
                    'subscriberFilter' => ['address' => $send->recipient, 'type' => 'PHONE'],
                    'content' => ['whatsappContent' => ['contentType' => 'TEXT', 'text' => $send->message_text]],
                ]);
                if ($response->status() === 200 && $response->json('requestId') === $send->request_id) {
                    $state = 'accepted';
                    $reason = null;
                } elseif ($response->clientError() && ! in_array($response->status(), [408, 429], true)) {
                    $state = 'rejected';
                    $reason = 'schedule_http_'.$response->status();
                }
            } catch (Throwable) {
                // The POST may have succeeded. Retries only consult history.
            }
            DB::transaction(function () use ($send, $state, $reason): void {
                EdnaOutOfHoursSend::whereKey($send->id)->where('state', 'sending')->update([
                    'state' => $state, 'reason' => $reason, 'updated_at' => now(),
                ]);
                if ($state !== 'rejected') {
                    Queue::connection('edna')->later(5, new ReconcileEdnaOutOfHours($send->id), '', 'edna');
                }
            });
        } catch (Throwable) {
            throw new RuntimeException('Out of hours send unconfirmed; inspect the send ID.');
        }
    }

    private function cancel(string $reason): void
    {
        EdnaOutOfHoursSend::whereKey($this->sendId)->where('state', 'pending')->update([
            'state' => 'cancelled', 'reason' => $reason, 'updated_at' => now(),
        ]);
    }

    public function failed(?Throwable $exception): void
    {
        $this->cancel('preflight_exhausted');
        EdnaOutOfHoursSend::whereKey($this->sendId)->where('state', 'sending')->update([
            'state' => 'unknown', 'reason' => 'worker_interrupted', 'updated_at' => now(),
        ]);
    }
}
