<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class WebFormContinuation
{
    public function receive(object $event, array $payload, ?int $sendId = null): ?array
    {
        $hash = (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
        if (! $hash) {
            return null;
        }

        return app(WebFormReceipt::class)->serialized($hash, fn () => $this->decide($event, $payload, $hash, $sendId));
    }

    private function decide(object $event, array $payload, string $hash, ?int $sendId): ?array
    {
        $text = (string) ($payload['messageContent']['text'] ?? '');
        preg_match_all('/\(solicitud:\s*([A-Za-z0-9]{32})\)/i', $text, $matches);
        $receipt = null;
        $reason = null;
        if (preg_match('/\(solicitud\s*:/i', $text)) {
            if (count($matches[1]) === 1 && preg_match_all('/\(solicitud\s*:/i', $text) === 1) {
                $receipt = DB::table('web_form_receipts')->where('reference_hash', hash('sha256', $matches[1][0]))
                    ->where('phone_hash', $hash)->where('expires_at', '>', now())->first();
            }
            if (! $receipt) {
                $reason = 'web_form_reference_unverified';
            }
        } elseif (DB::table('web_form_receipts')->where('phone_hash', $hash)->where('expires_at', '>', now())->exists()) {
            // A shared phone is a candidate, never proof of which person's form to use.
            $reason = 'web_form_reference_required';
        } elseif (preg_match('/acabo de completar el formulario|ya complet[eé] (?:el )?formulario|ya (?:llene|llené) (?:el )?formulario/iu', $text)) {
            $reason = 'web_form_claim_unverified';
        } else {
            return null;
        }
        $state = 'review';
        if ($receipt) {
            [$state, $reason] = match ($receipt->state) {
                'synced' => ['ready', 'web_form_already_processed'],
                'pending' => ['waiting', 'web_form_processing'],
                default => ['review', 'web_form_persistence_uncertain'],
            };
        }
        $decision = ['submission_id' => $receipt?->id, 'flow_send_id' => $sendId, 'state' => $state,
            'reason' => $reason, 'lead_id' => $receipt?->lead_id, 'proof_source' => $receipt ? 'reference' : 'unverified'];
        DB::table('web_form_continuations')->updateOrInsert(['entry_event_id' => $event->id],
            $decision + ['created_at' => now(), 'updated_at' => now()]);
        (new EdnaFlowRouter)->record($event->id, $state === 'review' ? 'web_form_review' : 'web_form_continuation', $sendId);
        if ($state === 'ready') {
            app(WebFormChatRouting::class)->schedule((int) $event->id, $receipt->id);
        }

        return $decision;
    }

    // Reuse the web outcome only with the original CRM binding AND the same identity.
    // The phone alone never settles a historical request. This method makes no CRM call.
    public function settleRedundant(int $id, bool $apply = false): ?array
    {
        return DB::transaction(function () use ($id, $apply) {
            $request = DB::table('edna_intake_requests')->where('id', $id)->lockForUpdate()->first();
            if (! $request || ! $request->answer
                || ! ($request->state === 'pending' || ($request->state === 'review'
                    && in_array($request->reason, ['bound_management_requires_review', 'bound_profile_conflict'], true)))) {
                return null;
            }
            $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
            if (! $send || $send->intake_test || ! (new EdnaIntake)->isChannelContract($send)
                || $send->state !== 'completed' || (int) $send->response_event_id !== (int) $request->response_event_id) {
                return null;
            }
            $proof = app(EdnaIntakeBinding::class)->verified($send);
            if (! $proof || ($request->lead_id && $request->lead_id !== $proof['lead_id'])) {
                return null;
            }
            $answer = json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR);
            $identity = app(WebFormReceipt::class)->identityHash((string) ($answer['cuil'] ?? ''));
            $hash = (new AttributionJourney)->phoneHash(Crypt::decryptString($send->recipient));
            if (! $identity || ! $hash) {
                return null;
            }
            $entryAt = CarbonImmutable::parse($send->entry_received_at);
            $receipt = DB::table('web_form_receipts')->where('state', 'synced')->where('lead_id', $proof['lead_id'])
                ->where('identity_hash', $identity)->where('phone_hash', $hash)
                ->where('received_at', '<=', $entryAt)->where('received_at', '>=', $entryAt->subDay())
                ->whereNotNull('persisted_at')->orderByDesc('received_at')->first();
            if (! $receipt || ($request->contact_id && $receipt->contact_id && $request->contact_id !== $receipt->contact_id)) {
                return null;
            }
            $result = ['request_id' => $id, 'send_id' => $send->id, 'lead_id' => $receipt->lead_id,
                'submission_id' => $receipt->id, 'previous_reason' => $request->reason, 'applied' => $apply];
            if ($apply) {
                DB::table('edna_intake_requests')->where('id', $id)->update([
                    'state' => 'synced', 'reason' => 'web_form_already_processed', 'lead_id' => $receipt->lead_id,
                    'contact_id' => $request->contact_id ?: $receipt->contact_id, 'updated_at' => now(),
                ]);
                DB::table('web_form_continuations')->updateOrInsert(['entry_event_id' => $send->entry_event_id], [
                    'submission_id' => $receipt->id, 'flow_send_id' => $send->id, 'state' => 'ready',
                    'reason' => 'web_form_already_processed', 'previous_reason' => $request->reason,
                    'proof_source' => 'crm_binding', 'lead_id' => $receipt->lead_id, 'created_at' => now(), 'updated_at' => now(),
                ]);
                app(WebFormChatRouting::class)->schedule((int) $send->entry_event_id, $receipt->id);
            }

            return $result;
        });
    }

    public function claimFlow(object $send, Closure $claim): bool
    {
        if (($send->intake_test ?? false) || ! (new EdnaIntake)->requiresChannelContract($send)) {
            return $claim();
        }
        $event = DB::table('edna_incoming_events')->find($send->entry_event_id);
        $payload = $event ? json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR) : null;
        if (! is_array($payload)) {
            return false;
        }
        $hash = (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
        if (! $hash) {
            return false;
        }

        return app(WebFormReceipt::class)->serialized($hash, function () use ($event, $payload, $hash, $send, $claim) {
            $current = DB::table('edna_flow_sends')->where('id', $send->id)->lockForUpdate()->first();
            if (! $current || $current->state !== 'pending'
                || app(EdnaFlowTransport::class)->id($current) !== app(EdnaFlowTransport::class)->id($send)) {
                return false;
            }
            $decision = $this->decide($event, $payload, $hash, $send->id);
            if ($decision) {
                app(EdnaFlowTransport::class)->update($send, ['pending'], [
                    'state' => 'cancelled', 'reason' => $decision['reason'], 'updated_at' => now(),
                ]);

                return false;
            }

            return $claim();
        });
    }
}
