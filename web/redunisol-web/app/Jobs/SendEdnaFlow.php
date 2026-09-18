<?php

namespace App\Jobs;

use App\Services\EdnaApi;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

class SendEdnaFlow implements ShouldQueue
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
            $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
            if (! $send || in_array($send->state, ['confirmed', 'completed', 'rejected', 'cancelled', 'expired', 'failed'], true)) {
                return;
            }
            if ($send->state !== 'pending') {
                // A previous process may have died after the POST. Only reconcile, never resend.
                Queue::connection('edna')->push(new ReconcileEdnaFlow($send->id), '', 'edna');

                return;
            }
            if (! config('edna.enabled') || ! config('edna.router_enabled') || $send->subject_id !== (string) config('edna.subject_id')) {
                $this->closePending('cancelled', 'router_disabled');

                return;
            }
            if (CarbonImmutable::parse($send->entry_received_at)->lt(now()->subHours(23))) {
                $this->closePending('expired', 'send_window_elapsed');

                return;
            }
            $api = new EdnaApi;
            $phone = Crypt::decryptString($send->recipient);
            $allowed = config('edna.router_recipients', []);
            if ($allowed && ! in_array($phone, $allowed, true)) {
                $this->closePending('cancelled', 'outside_pilot');

                return;
            }
            $api->assertCascade($send);
            $payload = ['requestId' => $send->request_id, 'comment' => $send->request_id,
                'cascadeId' => $send->cascade_id, 'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
                'content' => ['whatsappContent' => ['contentType' => 'FLOW', 'flowId' => (int) $send->flow_id,
                    'action' => 'navigate', 'caption' => 'Completar datos',
                    'text' => 'Para orientarte con tu consulta, indicá tu provincia y situación laboral en este formulario.']],
            ];
            // Commit the claim before any external side effect. One worker alone can win it.
            $claimed = DB::table('edna_flow_sends')->where('id', $send->id)->where('state', 'pending')->update([
                'state' => 'sending', 'send_started_at' => now(), 'updated_at' => now(),
            ]);
            if (! $claimed) {
                return;
            }
            $state = 'unknown';
            $reason = 'schedule_uncertain';
            try {
                $response = $api->post('cascade/schedule', $payload);
                if ($response->status() === 200 && $response->json('requestId') === $send->request_id) {
                    $state = 'accepted';
                    $reason = null;
                } elseif ($response->clientError() && ! in_array($response->status(), [408, 429], true)) {
                    $state = 'rejected';
                    $reason = 'schedule_http_'.$response->status();
                }
            } catch (Throwable) {
                // Timeout does not mean the message was not sent.
            }
            DB::transaction(function () use ($send, $state, $reason): void {
                DB::table('edna_flow_sends')->where('id', $send->id)->where('state', 'sending')->update([
                    'state' => $state, 'reason' => $reason,
                    'accepted_at' => $state === 'accepted' ? now() : null, 'updated_at' => now(),
                ]);
                if ($state !== 'rejected') {
                    Queue::connection('edna')->later(5, new ReconcileEdnaFlow($send->id), '', 'edna');
                }
            });
        } catch (Throwable) {
            throw new RuntimeException('Edna Flow job failed; inspect the send ID.');
        }
    }

    private function closePending(string $state, string $reason): void
    {
        DB::table('edna_flow_sends')->where('id', $this->sendId)->where('state', 'pending')
            ->update(['state' => $state, 'reason' => $reason, 'updated_at' => now()]);
    }

    public function failed(?Throwable $exception): void
    {
        $this->closePending('failed', 'preflight_exhausted');
        DB::table('edna_flow_sends')->where('id', $this->sendId)->where('state', 'sending')
            ->update(['state' => 'unknown', 'reason' => 'worker_interrupted', 'updated_at' => now()]);
    }
}
