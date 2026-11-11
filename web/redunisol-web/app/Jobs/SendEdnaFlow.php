<?php

namespace App\Jobs;

use App\Jobs\Middleware\TracksJourney;
use App\Services\EdnaApi;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaFlowTransport;
use App\Services\EdnaIntake;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicTransport;
use App\Services\WebFormContinuation;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class SendEdnaFlow implements ShouldQueue
{
    use Queueable;
    use TracksJourney;

    public int $tries = 8;

    // Organic sends recheck native attention after waiting in the queue. Provider
    // calls remain bounded; this timeout also leaves room to release the chat lock.
    public int $timeout = 105;

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
        $organicLock = null;
        $deadline = microtime(true) + 90;
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
            $organic = $this->organicContext($send);
            if ($organic === false) {
                $this->cancelOrganic($send, 'organic_flow_context_changed');

                return;
            }
            if ($organic !== null) {
                $store = Cache::getStore();
                if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
                    $this->deferOrganic($send, 'organic_shared_lock_unavailable');

                    return;
                }
                $organicLock = Cache::lock('web-form-chat:'.$organic['proof']['chat_id'], 120);
                if (! $organicLock->get()) {
                    $this->deferOrganic($send, 'organic_chat_routing_in_progress');

                    return;
                }
                if (! $this->organicReady($send, $organic, $deadline)) {
                    return;
                }
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
            if ($organic !== null && (! $this->organicReady($send, $organic, $deadline)
                || microtime(true) + 13 >= $deadline)) {
                if (microtime(true) + 13 >= $deadline) {
                    $this->deferOrganic($send, 'organic_preflight_budget_elapsed');
                }

                return;
            }
            // Commit the claim before any external side effect. One worker alone can win it.
            $claimed = app(WebFormContinuation::class)->claimFlow($send, fn () => $transport->update($send, ['pending'], [
                'state' => 'sending', 'send_started_at' => now(), 'updated_at' => now(),
            ]));
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
        } finally {
            try {
                $organicLock?->release();
            } catch (Throwable) {
                // Expiry releases a lost lock; it cannot authorize another POST.
            }
        }
    }

    /** Null means legacy; false means an organic context exists but cannot authorize a send. */
    private function organicContext(object $send): array|false|null
    {
        $rows = DB::table('edna_organic_menus')->where(fn ($q) => $q->where('flow_send_id', $send->id)
            ->orWhere('entry_event_id', $send->entry_event_id))->limit(2)->get();
        if ($rows->isEmpty()) {
            return null;
        }
        try {
            if ($rows->count() !== 1) {
                return false;
            }
            $menu = $rows->first();
            $proof = json_decode($menu->proof ?? '', true, 32, JSON_THROW_ON_ERROR);
            $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
            $choice = DB::table('edna_incoming_events')->find($menu->choice_event_id);
            $choicePayload = $choice ? json_decode(Crypt::decryptString($choice->payload ?? ''), true, 32, JSON_THROW_ON_ERROR) : null;
            $token = is_array($choicePayload) ? EdnaOrganicTransport::parseChoice($choicePayload['messageContent']['payload'] ?? null) : null;
            if (! config('edna.organic_menu_enabled') || (int) $menu->flow_send_id !== (int) $send->id
                || $menu->state !== 'flow_scheduled' || $menu->choice !== 'loan' || $menu->send_state !== 'confirmed'
                || (int) $menu->entry_event_id !== (int) $send->entry_event_id
                || $menu->subject_id !== $send->subject_id || ! Str::isUuid($menu->request_id)
                || $send->scope !== hash_hmac('sha256', 'organic-menu:'.$menu->request_id, (string) config('app.key'))
                || $send->flow_id !== (new EdnaIntake)->flowId()
                || ! hash_equals(Crypt::decryptString($send->recipient), Crypt::decryptString($menu->recipient))
                || ! is_array($proof) || ! $entry || ! $choice || ! $this->organicProof($proof, $entry)
                || ! is_array($proof['choice_proof'] ?? null) || ! $this->organicProof($proof['choice_proof'], $choice)
                || (string) ($proof['chat_id'] ?? '') !== (string) $menu->chat_id
                || (string) ($proof['session_id'] ?? '') !== (string) $menu->session_id
                || (string) $proof['choice_proof']['chat_id'] !== (string) $proof['chat_id']
                || (string) $proof['choice_proof']['session_id'] !== (string) $proof['session_id']
                || $token !== ['request_id' => $menu->request_id, 'choice' => 'loan']
                || ($choicePayload['subjectId'] ?? null) !== $send->subject_id
                || ($choicePayload['id'] ?? null) !== $choice->message_id
                || ! hash_equals(Crypt::decryptString($send->recipient), (string) ($choicePayload['subscriber']['identifier'] ?? ''))) {
                return false;
            }

            return ['menu_id' => (int) $menu->id, 'proof' => $proof];
        } catch (Throwable) {
            return false;
        }
    }

    private function organicProof(array $proof, object $event): bool
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id'
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $event->id
            || (string) ($proof['entry_message_id'] ?? '') !== (string) $event->message_id) {
            return false;
        }
        foreach (['chat_id', 'session_id', 'activity_id', 'message_id'] as $field) {
            if (! preg_match('/^[1-9][0-9]{0,17}$/D', (string) ($proof[$field] ?? ''))) {
                return false;
            }
        }

        return true;
    }

    private function organicReady(object $send, array $original, float $deadline): bool
    {
        if (microtime(true) + 35 >= $deadline) {
            $this->deferOrganic($send, 'organic_preflight_budget_elapsed');

            return false;
        }
        $fresh = $this->organicContext($send);
        if (! is_array($fresh) || $fresh !== $original) {
            $this->cancelOrganic($send, 'organic_flow_context_changed');

            return false;
        }
        $attention = app(EdnaOrganicAttention::class)->inspectWelcome($fresh['proof']);
        if (($attention['status'] ?? '') === 'waiting') {
            $this->deferOrganic($send, 'organic_attention_pending');

            return false;
        }
        if (($attention['status'] ?? '') !== 'ready'
            || (string) ($attention['session_id'] ?? '') !== (string) $fresh['proof']['session_id']) {
            $this->cancelOrganic($send, 'organic_human_attention_preserved');

            return false;
        }

        return true;
    }

    private function deferOrganic(object $send, string $reason): void
    {
        app(EdnaFlowTransport::class)->update($send, ['pending'], ['reason' => $reason, 'updated_at' => now()]);
        $this->release(30);
    }

    private function cancelOrganic(object $send, string $reason): void
    {
        if (app(EdnaFlowTransport::class)->update($send, ['pending'], ['state' => 'cancelled', 'reason' => $reason, 'updated_at' => now()])) {
            DB::table('edna_organic_menus')->where('flow_send_id', $send->id)->where('state', 'flow_scheduled')
                ->update(['state' => 'preserved', 'reason' => $reason, 'updated_at' => now()]);
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
