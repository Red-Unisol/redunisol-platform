<?php

namespace App\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Throwable;

/** Local paid routing receipts; campaign classification belongs to EdnaPaidEntry. */
class EdnaPaidFlowGuard
{
    public const ROUTE = 'paid_direct_v3';

    private const KINDS = ['provider_ad_referral', 'google_campaign_code', 'tracked_paid_click', 'documented_ad_prefill'];

    public function context(object $send): ?array
    {
        $context = $this->baseContext($send);
        if (($context['status'] ?? '') !== 'ready') {
            return $context;
        }
        foreach ($this->sessionSends($context['proof'], $send->subject_id, $context['phone_hash']) as $previous) {
            if ((int) $previous->id === (int) $send->id) {
                continue;
            }
            $proof = $this->baseContext($previous);
            if (($proof['status'] ?? '') !== 'ready' || $proof['phone_hash'] !== $context['phone_hash']) {
                continue;
            }
            if (in_array($previous->state, ['sending', 'accepted', 'unknown', 'confirmed', 'completed'], true)
                || ($previous->state === 'pending' && (int) $previous->id < (int) $send->id)) {
                return ['status' => 'duplicate', 'reason' => 'paid_session_already_has_flow'];
            }
        }

        return $context;
    }

    /** A verified paid session retains its route when a follow-up omits referral metadata. */
    public function continuesSession(array $proof, string $subject): bool
    {
        try {
            $entry = DB::table('edna_incoming_events')->find($proof['entry_event_id'] ?? 0);
            $phoneHash = $entry ? $this->entryHash($entry, $subject, $proof) : null;
            if (! $phoneHash) {
                return false;
            }
            foreach ($this->sessionSends($proof, $subject, $phoneHash) as $send) {
                $previous = $this->baseContext($send);
                if (($previous['status'] ?? '') === 'ready' && $previous['phone_hash'] === $phoneHash) {
                    return true;
                }
            }
        } catch (Throwable) {
            return false;
        }

        return false;
    }

    /** A phone match only postpones a second greeting while its native proof is unresolved. */
    public function pendingForRecipient(string $subject, string $phoneHash): bool
    {
        if ($subject !== (string) config('edna.subject_id') || ! preg_match('/^[a-f0-9]{64}$/D', $phoneHash)) {
            return false;
        }
        $rows = DB::table('edna_flow_sends as s')->join('edna_intake_admissions as a', 'a.id', '=', 's.intake_admission_id')
            ->leftJoin('edna_intake_bindings as b', 'b.flow_send_id', '=', 's.id')
            ->where('s.subject_id', $subject)->where('a.recipient_hash', $phoneHash)
            ->whereIn('s.state', ['pending', 'sending', 'accepted', 'unknown', 'confirmed'])
            ->where('s.entry_received_at', '>=', now()->subHours(23))->where('s.entry_received_at', '<=', now()->addMinutes(5))
            ->where(fn ($q) => $q->whereNull('b.id')->orWhere('b.state', '!=', 'verified'))->orderBy('s.id')->get(['s.*']);
        foreach ($rows as $send) {
            $context = $this->baseContext($send);
            if (($context['status'] ?? '') === 'waiting'
                || ($context['reason'] ?? '') === 'paid_native_binding_requires_review') {
                return true;
            }
        }

        return false;
    }

    public function marker(array $decision, int $entryEventId): ?array
    {
        $evidence = $decision['evidence'] ?? null;
        if (($decision['version'] ?? null) !== 1 || ($decision['route'] ?? '') !== self::ROUTE
            || (isset($decision['entry_event_id']) && $decision['entry_event_id'] !== $entryEventId)
            || ! is_array($evidence) || array_is_list($evidence) || count($evidence) > 12
            || ! in_array($evidence['kind'] ?? null, self::KINDS, true)) {
            return null;
        }
        foreach ($evidence as $name => $value) {
            if (! is_string($name) || ! preg_match('/^[a-z][a-z0-9_]{0,47}$/D', $name)
                || (! is_string($value) && ! is_int($value)) || strlen((string) $value) > 128) {
                return null;
            }
        }
        if (strlen(json_encode($evidence, JSON_THROW_ON_ERROR)) > 768) {
            return null;
        }

        return ['version' => 1, 'route' => self::ROUTE, 'entry_event_id' => $entryEventId, 'evidence' => $evidence];
    }

    private function baseContext(object $send): ?array
    {
        if (empty($send->attribution_snapshot)) {
            return null;
        }
        try {
            $snapshot = json_decode(Crypt::decryptString($send->attribution_snapshot), true, 32, JSON_THROW_ON_ERROR);
            if (! is_array($snapshot) || ! array_key_exists('entry_routing', $snapshot)) {
                return null;
            }
            $marker = $snapshot['entry_routing'];
            $entryId = (int) $send->entry_event_id;
            $normalized = is_array($marker) ? $this->marker($marker, $entryId) : null;
            if ($normalized === null || $normalized != $marker
                || $send->subject_id !== (string) config('edna.subject_id')
                || $send->scope !== hash_hmac('sha256', 'paid-entry:'.$entryId, (string) config('app.key'))
                || ! (new EdnaIntake)->isChannelContract($send) || $send->flow_id !== (new EdnaIntake)->flowId()
                || (($marker['evidence']['kind'] ?? '') === 'tracked_paid_click'
                    && (($snapshot['status'] ?? '') !== 'resolved'
                        || ($snapshot['journey_id'] ?? null) !== ($marker['evidence']['journey_id'] ?? null)))) {
                return ['status' => 'invalid', 'reason' => 'paid_flow_context_changed'];
            }
            $entry = DB::table('edna_incoming_events')->find($entryId);
            $hash = $entry ? $this->entryHash($entry, $send->subject_id) : null;
            if (! $hash || ! $send->recipient
                || ! hash_equals($hash, (new AttributionJourney)->phoneHash(Crypt::decryptString($send->recipient)) ?? '')) {
                return ['status' => 'invalid', 'reason' => 'paid_flow_entry_changed'];
            }
            $binding = DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->first();
            if (! $binding || $binding->state === 'pending') {
                return ['status' => 'waiting', 'reason' => 'paid_native_binding_pending'];
            }
            if ($binding->state !== 'verified') {
                return ['status' => 'invalid', 'reason' => 'paid_native_binding_requires_review'];
            }
            $proof = (new EdnaIntakeBinding)->verified($send);
            if (! $proof || ! $this->entryHash($entry, $send->subject_id, $proof)) {
                return ['status' => 'invalid', 'reason' => 'paid_native_binding_invalid'];
            }

            return ['status' => 'ready', 'route' => self::ROUTE, 'entry_event_id' => $entryId,
                'phone_hash' => $hash, 'proof' => $proof];
        } catch (Throwable) {
            return ['status' => 'invalid', 'reason' => 'paid_flow_context_invalid'];
        }
    }

    private function entryHash(object $entry, string $subject, ?array $proof = null): ?string
    {
        if ($subject !== (string) config('edna.subject_id') || $entry->subject_id !== $subject) {
            return null;
        }
        if ($proof !== null) {
            if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
                || ($proof['evidence'] ?? '') !== 'external_message_id'
                || (string) ($proof['entry_event_id'] ?? '') !== (string) $entry->id
                || (string) ($proof['entry_message_id'] ?? '') !== (string) $entry->message_id) {
                return null;
            }
            foreach (['chat_id', 'session_id', 'activity_id', 'message_id'] as $field) {
                if (! preg_match('/^[1-9][0-9]{0,17}$/D', (string) ($proof[$field] ?? ''))) {
                    return null;
                }
            }
        }
        $payload = json_decode(Crypt::decryptString($entry->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
        if (! is_array($payload) || ($payload['id'] ?? null) !== $entry->message_id
            || ($payload['subjectId'] ?? null) !== $subject) {
            return null;
        }

        return (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
    }

    private function sessionSends(array $proof, string $subject, string $phoneHash): Collection
    {
        return DB::table('edna_flow_sends as s')->join('edna_intake_bindings as b', 'b.flow_send_id', '=', 's.id')
            ->join('edna_intake_admissions as a', 'a.id', '=', 's.intake_admission_id')
            ->where('s.subject_id', $subject)->where('b.state', 'verified')
            ->where('a.recipient_hash', $phoneHash)->orderBy('s.id')->get(['s.*', 'b.proof as native_proof'])
            // Binding proof is a TEXT column in both supported databases, not JSONB.
            ->filter(function ($send) use ($proof): bool {
                $native = json_decode($send->native_proof ?? '', true);

                return is_array($native) && (string) ($native['chat_id'] ?? '') === (string) $proof['chat_id']
                    && (string) ($native['session_id'] ?? '') === (string) $proof['session_id'];
            });
    }
}
