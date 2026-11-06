<?php

namespace App\Jobs;

use App\Jobs\Middleware\TracksJourney;
use App\Services\EdnaApi;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaFlowTransport;
use App\Services\EdnaIntake;
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
    use TracksJourney;

    public int $tries = 8;

    public int $timeout = 40;

    // A real property default also applies to payloads serialized before aliases existed.
    public ?string $transportRequestId = null;

    public function __construct(public readonly int $sendId, ?string $transportRequestId = null)
    {
        $this->transportRequestId = $transportRequestId;
    }

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
            $transport = app(EdnaFlowTransport::class);
            if (! $send || ! $transport->matches($send, $this->transportRequestId)
                || in_array($send->state, ['confirmed', 'completed', 'rejected', 'cancelled', 'expired', 'failed'], true)) {
                return;
            }
            $transportId = $transport->id($send);
            if ($send->state !== 'pending') {
                // A previous process may have died after the POST. Only reconcile, never resend.
                Queue::connection('edna')->push(new ReconcileEdnaFlow($send->id, $transportId), '', 'edna');

                return;
            }
            if (! config('edna.enabled') || ! config('edna.router_enabled') || $send->subject_id !== (string) config('edna.subject_id')) {
                $this->closePending($send, 'cancelled', 'router_disabled');

                return;
            }
            if (CarbonImmutable::parse($send->entry_received_at)->lt(now()->subHours(23))) {
                $this->closePending($send, 'expired', 'send_window_elapsed');

                return;
            }
            $intake = $send->flow_id !== EdnaFlowRouter::FLOW_ID;
            if ($intake && ! (new EdnaIntake)->canSend($send)) {
                $this->closePending($send, 'cancelled', 'intake_context_changed');

                return;
            }
            $api = new EdnaApi;
            $phone = Crypt::decryptString($send->recipient);
            $allowed = config('edna.router_recipients', []);
            if (! ($send->intake_test ?? false) && $allowed && ! in_array($phone, $allowed, true)) {
                $this->closePending($send, 'cancelled', 'outside_pilot');

                return;
            }
            $api->assertCascade($send);
            $payload = ['requestId' => $transportId, 'comment' => $transportId,
                'cascadeId' => $send->cascade_id, 'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
                'content' => ['whatsappContent' => ['contentType' => 'FLOW', 'flowId' => (int) $send->flow_id,
                    'action' => 'navigate', 'caption' => 'Completar datos',
                    'text' => ($send->intake_test ?? false)
                        ? 'PRUEBA COMPLETA: esta solicitud se registra en Bitrix y ejecuta la evaluación real. Completá tu CUIL; el email es opcional.'
                        : ($intake
                        ? 'Completá tu solicitud acá en WhatsApp. Necesitamos tu CUIL; el email es opcional.'
                        : 'Para orientarte con tu consulta, indicá tu provincia y situación laboral en este formulario.')]],
            ];
            // Commit the claim before any external side effect. One worker alone can win it.
            $claimed = $transport->update($send, ['pending'], [
                'state' => 'sending', 'send_started_at' => now(), 'updated_at' => now(),
            ]);
            if (! $claimed) {
                return;
            }
            $state = 'unknown';
            $reason = 'schedule_uncertain';
            try {
                $response = $api->post('cascade/schedule', $payload);
                if ($response->status() === 200 && $response->json('requestId') === $transportId) {
                    $state = 'accepted';
                    $reason = null;
                } elseif ($response->clientError() && ! in_array($response->status(), [408, 429], true)) {
                    $state = 'rejected';
                    $reason = 'schedule_http_'.$response->status();
                }
            } catch (Throwable) {
                // Timeout does not mean the message was not sent.
            }
            DB::transaction(function () use ($send, $state, $reason, $transport, $transportId): void {
                $updated = $transport->update($send, ['sending'], [
                    'state' => $state, 'reason' => $reason,
                    'accepted_at' => $state === 'accepted' ? now() : null, 'updated_at' => now(),
                ]);
                if ($updated && $state !== 'rejected') {
                    Queue::connection('edna')->later(5, new ReconcileEdnaFlow($send->id, $transportId), '', 'edna');
                }
            });
        } catch (Throwable) {
            throw new RuntimeException('Edna Flow job failed; inspect the send ID.');
        }
    }

    private function closePending(object $send, string $state, string $reason): void
    {
        app(EdnaFlowTransport::class)->update($send, ['pending'], [
            'state' => $state, 'reason' => $reason, 'updated_at' => now(),
        ]);
    }

    public function failed(?Throwable $exception): void
    {
        $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
        $transport = app(EdnaFlowTransport::class);
        if (! $send || ! $transport->matches($send, $this->transportRequestId)) {
            return;
        }
        $this->closePending($send, 'failed', 'preflight_exhausted');
        $transport->update($send, ['sending'], [
            'state' => 'unknown', 'reason' => 'worker_interrupted', 'updated_at' => now(),
        ]);
    }
}
