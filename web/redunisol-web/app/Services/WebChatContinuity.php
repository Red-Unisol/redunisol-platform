<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/** A transport-scoped waiting context never substitutes for a proved CRM identity. */
class WebChatContinuity
{
    public const NAME = 'web-chat-continuity-v1';

    public const WINDOW_HOURS = 8;

    public function eligibleEntry(object $event, int $salesCredit = 0): bool
    {
        return $this->authenticated($event, salesCredit: $salesCredit) !== null;
    }

    public function captureReference(object $event, object $receipt): ?int
    {
        $payload = $this->authenticated($event);
        $cut = $this->cutover();
        if (! $payload || ! $cut || ($payload['messageContent']['type'] ?? '') === 'FLOW'
            || $this->releasedEntry((int) $event->id)) {
            return null;
        }
        preg_match_all('/\(solicitud:\s*([A-Za-z0-9]{32})\)/i', (string) ($payload['messageContent']['text'] ?? ''), $matches);
        $hash = $this->hash($payload);
        if (count($matches[1]) !== 1
            || preg_match_all('/\(solicitud\s*:/i', (string) ($payload['messageContent']['text'] ?? '')) !== 1
            || ! $hash || ! is_string($receipt->id ?? null)) {
            return null;
        }
        $received = CarbonImmutable::parse($payload['receivedAt'])->utc();
        $receiptId = $receipt->id;

        return app(WebFormReceipt::class)->serialized($hash, function () use ($event, $receiptId, $matches, $hash, $received, $cut): ?int {
            // Share the receipt lock with result(): neither side can miss a newly
            // created continuation or restore pending after a synced ACK.
            $stored = DB::table('web_form_receipts')->where('id', $receiptId)->lockForUpdate()->first();
            if (! $stored || ! $stored->reference_hash
                || ! hash_equals($stored->reference_hash, hash('sha256', $matches[1][0]))
                || ! hash_equals((string) $stored->phone_hash, $hash)
                || ! $this->afterCut($stored->created_at, $cut)
                || CarbonImmutable::parse($stored->expires_at)->lte(now())
                || $received->lt(CarbonImmutable::parse($stored->received_at)->subSeconds(5))
                || $received->gt(CarbonImmutable::parse($stored->expires_at))) {
                return null;
            }
            // Repeating a reference does not renew its anchor, expiry or session.
            $context = DB::table('web_chat_contexts')->where('subject_id', (string) $event->subject_id)
                ->where('phone_hash', $hash)->where('submission_id', $stored->id)->lockForUpdate()->first();
            if ($context && $context->state === 'released' && $context->reason === 'newer_explicit_reference_same_session') {
                // Keep an old link pasted again from falling through to the
                // legacy reference resolver and overriding the chosen request.
                $this->continuation($event, $context, 'review', 'web_reference_superseded');

                return (int) $context->id;
            }
            if ($context && (! $this->active($context, $cut) || (int) $context->anchor_entry_event_id > (int) $event->id)) {
                return null;
            }
            if (! $context) {
                $id = DB::table('web_chat_contexts')->insertGetId([
                    'subject_id' => (string) $event->subject_id, 'phone_hash' => $hash,
                    'anchor_entry_event_id' => $event->id, 'submission_id' => $stored->id,
                    'state' => 'waiting', 'reason' => 'web_context_awaiting_native_proof',
                    'expires_at' => $received->addHours(self::WINDOW_HOURS), 'last_entry_event_id' => $event->id,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $context = DB::table('web_chat_contexts')->find($id);
            }
            $ambiguous = $this->contexts((string) $event->subject_id, $hash, $cut)->pluck('submission_id')->unique()->count() > 1;
            // Only a new, exact reference may queue native verification of a
            // replacement. Untagged replies still cannot choose between requests.
            if ($ambiguous && $this->replaceableContexts($context, $event, $cut) !== null) {
                $this->continuation($event, $context, 'ready', 'explicit_replacement_pending');

                return (int) $context->id;
            }
            $state = $ambiguous ? 'review' : ($stored->state === 'synced' ? 'ready' : ($stored->state === 'pending' ? 'waiting' : 'review'));
            $reason = $ambiguous ? 'web_context_multiple_submissions' : 'web_context_reference';
            if ($ambiguous) {
                $this->markAmbiguous((string) $event->subject_id, $hash, $cut);
            }
            $this->continuation($event, $context, $state, $reason);

            return (int) $context->id;
        });
    }

    public function receive(object $event, array $payload): ?array
    {
        $stored = $this->authenticated($event, $payload);
        $cut = $this->cutover();
        if (! $stored || ! $cut || ($stored['messageContent']['type'] ?? '') === 'FLOW'
            || preg_match('/\(solicitud\s*:/i', (string) ($stored['messageContent']['text'] ?? ''))
            || $this->releasedEntry((int) $event->id) || ! ($hash = $this->hash($stored))) {
            return null;
        }

        return app(WebFormReceipt::class)->serialized($hash, function () use ($event, $hash, $cut): ?array {
            $contexts = $this->contexts((string) $event->subject_id, $hash, $cut)->lockForUpdate()->get();
            if ($contexts->isEmpty()) {
                return null;
            }
            if ($contexts->pluck('submission_id')->unique()->count() !== 1) {
                $this->markAmbiguous((string) $event->subject_id, $hash, $cut);
                DB::table('web_form_continuations')->updateOrInsert(['entry_event_id' => $event->id], [
                    'context_id' => null, 'submission_id' => null, 'flow_send_id' => null,
                    'state' => 'review', 'reason' => 'web_context_multiple_submissions',
                    'proof_source' => 'web_context', 'lead_id' => null, 'created_at' => now(), 'updated_at' => now(),
                ]);

                return $this->decision((int) $event->id);
            }
            $context = $contexts->first();
            $receipt = DB::table('web_form_receipts')->where('id', $context->submission_id)->lockForUpdate()->first();
            if (! $receipt) {
                $this->continuation($event, $context, 'review', 'web_context_receipt_unavailable');

                return $this->decision((int) $event->id);
            }
            $state = $receipt->state === 'synced' ? 'ready' : ($receipt->state === 'pending' ? 'waiting' : 'review');
            $this->continuation($event, $context, $state, 'web_context_continuation');
            if ($state !== 'review') {
                app(WebFormChatRouting::class)->schedule((int) $event->id, $context->submission_id);
            }

            return $this->decision((int) $event->id);
        });
    }

    /** Suppress an outbound question only; this method cannot select any CRM record. */
    public function blocksOutbound(object $event, ?array $proof = null): bool
    {
        $payload = $this->authenticated($event);
        $cut = $this->cutover();
        if (! $payload || ! $cut || ($payload['messageContent']['type'] ?? '') === 'FLOW'
            || ! ($hash = $this->hash($payload)) || $this->releasedEntry((int) $event->id)) {
            return false;
        }
        $contexts = $this->contexts((string) $event->subject_id, $hash, $cut)->get();
        if ($contexts->pluck('submission_id')->unique()->count() > 1) {
            return true;
        }
        foreach ($contexts as $context) {
            if (! $context->chat_id || ! $context->session_id) {
                return true;
            }
            if ($proof && $this->validProof($proof, $event)
                && (string) $proof['chat_id'] === (string) $context->chat_id
                && (string) $proof['session_id'] === (string) $context->session_id) {
                return true;
            }
        }

        return false;
    }

    public function bind(int $entryId, array $proof, int $salesCredit = 0): array
    {
        $continuation = DB::table('web_form_continuations')->where('entry_event_id', $entryId)->first();
        $context = $continuation?->context_id ? DB::table('web_chat_contexts')->find($continuation->context_id) : null;
        if (! $context || ($continuation->proof_source ?? '') !== 'web_context') {
            return $this->result('review', 'web_context_unavailable');
        }

        return app(WebFormReceipt::class)->serialized($context->phone_hash, function () use ($entryId, $proof, $context, $salesCredit): array {
            $context = DB::table('web_chat_contexts')->where('id', $context->id)->lockForUpdate()->first();
            $event = DB::table('edna_incoming_events')->find($entryId);
            $payload = $event ? $this->authenticated($event, salesCredit: $salesCredit) : null;
            $cut = $this->cutover();
            if (! $context || ! $event || ! $payload || ! $cut || ! $this->active($context, $cut)) {
                return $this->result('released', 'web_context_expired_or_ended', $context?->id);
            }
            if ((string) $context->subject_id !== (string) $event->subject_id
                || ! hash_equals($context->phone_hash, (string) $this->hash($payload))
                || ! $this->validProof($proof, $event)) {
                return $this->result('review', 'web_context_message_unverified', $context->id);
            }
            if ($context->sales_opening_at && $context->state === 'review') {
                return $this->result('review', 'web_context_multiple_submissions', $context->id);
            }
            if ($this->contexts($context->subject_id, $context->phone_hash, $cut)->where('submission_id', '!=', $context->submission_id)->exists()
                && ! $this->selectExplicitReference($context, $event, $payload, $proof, $cut)) {
                $this->markAmbiguous($context->subject_id, $context->phone_hash, $cut);

                return $this->result('review', 'web_context_multiple_submissions', $context->id);
            }
            $anchor = DB::table('edna_incoming_events')->find($context->anchor_entry_event_id);
            $anchorCredit = $context->sales_expires_at
                ? max(0, CarbonImmutable::parse($context->sales_expires_at)->timestamp - CarbonImmutable::parse($context->expires_at)->timestamp) : 0;
            $anchorPayload = $anchor ? $this->authenticated($anchor, salesCredit: $anchorCredit) : null;
            if (! $anchor || ! $anchorPayload || ! $this->validAnchor($context, $anchorPayload, $cut)) {
                return $this->result('review', 'web_context_anchor_unverified', $context->id);
            }
            if (! $context->chat_id || ! $context->session_id) {
                $anchorProof = (int) $context->anchor_entry_event_id === $entryId ? $proof : null;
                if (! $anchorProof) {
                    try {
                        $anchorProof = app(EdnaMessageBinding::class)->resolve($anchor, $anchorPayload, (int) $proof['chat_id']);
                    } catch (Throwable) {
                        $anchorProof = null;
                    }
                }
                if (! is_array($anchorProof) || ! $this->validProof($anchorProof, $anchor)) {
                    return $this->result('review', 'web_context_anchor_unverified', $context->id);
                }
                DB::table('web_chat_contexts')->where('id', $context->id)->update([
                    'chat_id' => $anchorProof['chat_id'], 'session_id' => $anchorProof['session_id'],
                    'proof' => json_encode($anchorProof, JSON_THROW_ON_ERROR), 'state' => 'bound',
                    'reason' => 'web_context_anchor_bound', 'updated_at' => now(),
                ]);
                $context = DB::table('web_chat_contexts')->find($context->id);
            }
            if ((string) $context->chat_id !== (string) $proof['chat_id']) {
                return $this->result('review', 'web_context_chat_mismatch', $context->id);
            }
            if ((string) $context->session_id !== (string) $proof['session_id']) {
                DB::table('web_chat_contexts')->where('id', $context->id)->update([
                    'state' => 'released', 'reason' => 'web_context_session_changed', 'updated_at' => now(),
                ]);
                DB::table('web_form_continuations')->where('entry_event_id', $entryId)->update([
                    'state' => 'released', 'reason' => 'web_context_session_changed', 'updated_at' => now(),
                ]);
                // This is the fresh callback itself, not a replay of a webhook or old job.
                $rerouted = app(EdnaIntake::class)->receiveEntry($event, $payload);

                return $this->result('released', 'web_context_session_changed', $context->id) + ['rerouted' => $rerouted];
            }
            if ($context->state === 'preserved') {
                return $this->result('preserved', $context->reason ?: 'web_context_human_attention_preserved', $context->id);
            }

            return $this->result('bound', 'web_context_session_verified', $context->id) + ['proof' => $proof];
        });
    }

    /** Receipt metadata is separate from an observed owner and never invents a transfer. */
    public function sync(int $entryId, string $state, string $reason, array $fields = []): void
    {
        $continuation = DB::table('web_form_continuations')->where('entry_event_id', $entryId)->first();
        if (! $continuation?->context_id || $continuation->proof_source !== 'web_context') {
            return;
        }
        DB::transaction(function () use ($entryId, $state, $reason, $fields, $continuation): void {
            $context = DB::table('web_chat_contexts')->where('id', $continuation->context_id)->lockForUpdate()->first();
            $event = DB::table('edna_incoming_events')->find($entryId);
            $cut = $this->cutover();
            $salesCredit = $fields['sales_credit_seconds'] ?? 0;
            if (! $context || ! $cut || ! $this->active($context, $cut) || ! $event || ! $this->eligibleEntry($event, $salesCredit)) {
                return;
            }
            $update = ['route_state' => $state, 'reason' => $reason, 'last_route_entry_event_id' => $entryId, 'updated_at' => now()];
            foreach (['lead_id', 'contact_id', 'deal_id', 'seller_id'] as $key) {
                if (isset($fields[$key]) && $this->id($fields[$key])) {
                    $update[$key] = (string) $fields[$key];
                }
            }
            if (isset($fields['link_state']) && is_string($fields['link_state'])) {
                $update['link_state'] = $fields['link_state'];
            }
            $proof = $this->decode($fields['proof'] ?? null);
            $intent = $fields['transfer_intent'] ?? $proof['transfer_intent'] ?? null;
            $ack = $fields['transfer_acknowledged'] ?? $proof['transfer_acknowledged'] ?? false;
            $transfer = $fields['transfer_state'] ?? 'pending';
            $confirmed = $transfer === 'confirmed' && $ack === true && $this->confirmedIntent($intent, $context);
            if ($confirmed) {
                $update += ['transfer_state' => 'confirmed', 'transfer_acknowledged' => true,
                    'transfer_intent' => json_encode($intent, JSON_THROW_ON_ERROR),
                    'confirmed_transfer_entry_event_id' => $entryId, 'resolved_at' => now()];
                $update['state'] = $context->state === 'preserved' ? 'preserved' : 'resolved';
            } elseif (! $context->transfer_acknowledged) {
                $update += ['transfer_state' => is_string($transfer) ? $transfer : 'pending', 'transfer_acknowledged' => false];
                if (is_array($intent)) {
                    $update['transfer_intent'] = json_encode($intent, JSON_THROW_ON_ERROR);
                }
            }
            if (in_array($transfer, ['observed', 'not_needed'], true) || ($fields['link_state'] ?? '') === 'linked') {
                $update['observed_at'] = now();
                if (! in_array($context->state, ['resolved', 'preserved'], true) && ! $confirmed) {
                    $update['state'] = 'observed';
                }
            }
            if ($state === 'preserved') {
                $update['state'] = 'preserved';
            }
            DB::table('web_chat_contexts')->where('id', $context->id)->update($update);
        });
    }

    /** A proven continuation can wait for qualification, at most one day from the original message. */
    public function commercialDeadline(int $id, object $route, array $proof, CarbonImmutable $limit): ?CarbonImmutable
    {
        $context = DB::table('web_chat_contexts')->where('id', $id)->lockForUpdate()->first();
        if (! $context || $context->submission_id !== $route->submission_id || ! $this->id($context->chat_id)
            || ! $this->id($context->session_id) || (string) $context->chat_id !== (string) ($proof['chat_id'] ?? '')
            || (string) $context->session_id !== (string) ($proof['session_id'] ?? '')
            || in_array($context->state, ['released', 'expired', 'preserved', 'review'], true)) {
            return null;
        }
        $limit = $limit->min(CarbonImmutable::parse($context->expires_at)->addHours(24 - self::WINDOW_HOURS));
        $current = CarbonImmutable::parse($context->sales_expires_at ?? $context->expires_at);
        if ($current->isPast()) {
            return null;
        }
        if ($limit->gt($current)) {
            DB::table('web_chat_contexts')->where('id', $id)->update(['sales_expires_at' => $limit, 'updated_at' => now()]);
        }

        return $limit;
    }

    /** Called in the route's lease transaction. Follow-ups must still prove this exact chat and session. */
    public function holdForOpening(int $contextId, object $route, array $proof, CarbonImmutable $start, CarbonImmutable $open): void
    {
        $context = DB::table('web_chat_contexts')->where('id', $contextId)->lockForUpdate()->first();
        if (! $context || $context->submission_id !== $route->submission_id
            || ! $this->id($context->chat_id) || (string) $context->chat_id !== (string) ($proof['chat_id'] ?? '')
            || ! $this->id($context->session_id) || (string) $context->session_id !== (string) ($proof['session_id'] ?? '')
            || in_array($context->state, ['released', 'expired', 'preserved', 'review'], true)) {
            return;
        }
        $deadline = CarbonImmutable::parse($context->sales_expires_at ?? $context->expires_at);
        if ($context->sales_opening_at) {
            $start = $start->max(CarbonImmutable::parse($context->sales_opening_at));
        }
        if ($start->lt($deadline) && $start->lt($open)) {
            DB::table('web_chat_contexts')->where('id', $contextId)->update(['sales_opening_at' => $open,
                'sales_expires_at' => $deadline->addSeconds($open->timestamp - $start->timestamp), 'updated_at' => now()]);
        }
    }

    private function validAnchor(object $context, array $payload, object $cut): bool
    {
        $receipt = DB::table('web_form_receipts')->find($context->submission_id);
        preg_match_all('/\(solicitud:\s*([A-Za-z0-9]{32})\)/i', (string) ($payload['messageContent']['text'] ?? ''), $matches);
        if (! $receipt || ! $this->afterCut($receipt->created_at, $cut) || count($matches[1]) !== 1
            || ! hash_equals($context->phone_hash, (string) $this->hash($payload))
            || ! hash_equals($context->phone_hash, (string) $receipt->phone_hash)
            || ! hash_equals((string) $receipt->reference_hash, hash('sha256', $matches[1][0]))) {
            return false;
        }
        try {
            $received = CarbonImmutable::parse($payload['receivedAt']);

            return $received->gte(CarbonImmutable::parse($receipt->received_at)->subSeconds(5))
                && $received->lte(CarbonImmutable::parse($receipt->expires_at))
                && CarbonImmutable::parse($context->expires_at)->lte($received->addHours(self::WINDOW_HOURS));
        } catch (Throwable) {
            return false;
        }
    }

    private function confirmedIntent(mixed $intent, object $context): bool
    {
        if (! $this->id($context->chat_id) || ! $this->id($context->session_id) || ! is_array($intent)
            || (string) ($intent['session_id'] ?? '') !== (string) $context->session_id
            || ! $this->id($intent['seller_id'] ?? $intent['target_id'] ?? null)
            || ! preg_match('/^(?:0|[1-9][0-9]{0,18})$/D', (string) ($intent['owner_before'] ?? ''))
            || ! is_string($intent['created_at'] ?? null)
            || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $intent['created_at'])) {
            return false;
        }
        try {
            $created = CarbonImmutable::parse($intent['created_at']);

            return $created->gte(CarbonImmutable::parse($context->created_at)) && $created->lte(now()->addMinutes(5));
        } catch (Throwable) {
            return false;
        }
    }

    private function authenticated(object $event, ?array $provided = null, int $salesCredit = 0): ?array
    {
        $cut = $this->cutover();
        if (! $cut || ! $this->id($event->id ?? null) || (int) $event->id <= (int) $cut->entry_id_after
            || (string) ($event->subject_id ?? '') !== (string) config('edna.subject_id')) {
            return null;
        }
        try {
            $payload = json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
            $timestamp = $payload['receivedAt'] ?? null;
            if (! is_array($payload) || (string) ($payload['id'] ?? '') !== (string) $event->message_id
                || (string) ($payload['subjectId'] ?? '') !== (string) $event->subject_id
                || ($provided !== null && $provided !== $payload)
                || ! is_string($timestamp) || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/D', $timestamp)
                || ! $this->hash($payload)) {
                return null;
            }
            $received = CarbonImmutable::parse($timestamp);

            return $received->gte(CarbonImmutable::parse($cut->starts_at))
                && $received->gt(now()->subHours(self::WINDOW_HOURS)->subSeconds($salesCredit)) && $received->lte(now()->addMinutes(5)) ? $payload : null;
        } catch (Throwable) {
            return null;
        }
    }

    private function cutover(): ?object
    {
        if (! Schema::hasTable('web_chat_contexts') || ! Schema::hasTable('edna_intake_cutovers')) {
            return null;
        }

        return DB::table('edna_intake_cutovers')->where('name', self::NAME)->first();
    }

    private function contexts(string $subject, string $hash, object $cut): Builder
    {
        return DB::table('web_chat_contexts')->where('subject_id', $subject)->where('phone_hash', $hash)
            ->where('created_at', '>=', $cut->starts_at)->where('anchor_entry_event_id', '>', $cut->entry_id_after)
            ->where(fn ($q) => $q->where('expires_at', '>', now())->orWhere('sales_expires_at', '>', now()))
            ->whereNotIn('state', ['released', 'expired'])->orderBy('id');
    }

    private function active(object $context, object $cut): bool
    {
        return $this->afterCut($context->created_at, $cut) && (int) $context->anchor_entry_event_id > (int) $cut->entry_id_after
            && ! in_array($context->state, ['released', 'expired'], true) && CarbonImmutable::parse($context->sales_expires_at ?? $context->expires_at)->gt(now());
    }

    private function afterCut(mixed $timestamp, object $cut): bool
    {
        try {
            return CarbonImmutable::parse($timestamp)->gte(CarbonImmutable::parse($cut->starts_at));
        } catch (Throwable) {
            return false;
        }
    }

    private function hash(array $payload): ?string
    {
        return (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
    }

    private function validProof(array $proof, object $event): bool
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id'
            || (array_key_exists('version', $proof) && ! in_array($proof['version'], [1, 2], true))
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $event->id
            || (string) ($proof['entry_message_id'] ?? '') !== (string) $event->message_id) {
            return false;
        }
        foreach (['chat_id', 'session_id', 'message_id', 'activity_id'] as $key) {
            if (! $this->id($proof[$key] ?? null)) {
                return false;
            }
        }

        return true;
    }

    private function continuation(object $event, object $context, string $state, string $reason): void
    {
        DB::table('web_form_continuations')->updateOrInsert(['entry_event_id' => $event->id], [
            'context_id' => $context->id, 'submission_id' => $context->submission_id, 'flow_send_id' => null,
            'state' => $state, 'reason' => $reason, 'proof_source' => 'web_context', 'lead_id' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('web_chat_contexts')->where('id', $context->id)->update(['last_entry_event_id' => $event->id, 'updated_at' => now()]);
    }

    private function decision(int $entryId): ?array
    {
        $row = DB::table('web_form_continuations')->where('entry_event_id', $entryId)->first();

        return $row ? (array) $row : null;
    }

    private function releasedEntry(int $entryId): bool
    {
        return DB::table('web_form_continuations')->where('entry_event_id', $entryId)->where('state', 'released')->exists();
    }

    /** Caller holds the recipient lock. Only untouched, older requests for the same proven person qualify. */
    private function replaceableContexts(object $selected, object $event, object $cut): ?array
    {
        if ((int) $selected->anchor_entry_event_id !== (int) $event->id
            || ! in_array($selected->state, ['waiting', 'bound', 'review'], true)
            || ($selected->state === 'review' && $selected->reason !== 'web_context_multiple_submissions')) {
            return null;
        }
        $others = $this->contexts($selected->subject_id, $selected->phone_hash, $cut)
            ->where('id', '!=', $selected->id)->limit(5)->get();
        if ($others->isEmpty() || $others->count() > 4) {
            return null;
        }
        $ids = $others->pluck('submission_id')->push($selected->submission_id);
        $receipts = DB::table('web_form_receipts')->whereIn('id', $ids)->get()->keyBy('id');
        $new = $receipts->get($selected->submission_id);
        if (! $new || $new->state !== 'synced' || ! $this->id($new->lead_id) || ! $this->id($new->contact_id)
            || ! is_string($new->identity_hash) || ! preg_match('/^[0-9a-f]{64}$/D', $new->identity_hash)) {
            return null;
        }
        foreach ($others as $old) {
            $receipt = $receipts->get($old->submission_id);
            if (! $receipt || $receipt->state !== 'synced' || $receipt->identity_hash !== $new->identity_hash
                || $receipt->contact_id !== $new->contact_id || ! $this->id($receipt->lead_id)
                || ! $this->id($old->chat_id) || ! $this->id($old->session_id)
                || (int) $old->anchor_entry_event_id >= (int) $event->id
                || CarbonImmutable::parse($receipt->received_at)->gte(CarbonImmutable::parse($new->received_at))
                || ! in_array($old->state, ['bound', 'review'], true)
                || ($old->state === 'review' && $old->reason !== 'web_context_multiple_submissions')
                || $old->observed_at || $old->resolved_at || $old->transfer_intent) {
                return null;
            }
        }
        // An uncertain external action or evidence of human attention keeps the
        // old request protected even when its journal synchronization was delayed.
        $protected = DB::table('web_form_chat_routes')->whereIn('submission_id', $others->pluck('submission_id'))
            ->where(fn ($q) => $q->where('transfer_state', '!=', 'pending')->orWhere('link_state', '!=', 'pending')
                ->orWhereIn('state', ['preserved', 'routed', 'linked', 'unknown'])->orWhereNotNull('proof->transfer_intent'))
            ->exists();

        return $protected ? null : $others->all();
    }

    private function selectExplicitReference(object $context, object $event, array $payload, array $proof, object $cut): bool
    {
        if (! $this->validAnchor($context, $payload, $cut)) {
            return false;
        }
        $others = $this->replaceableContexts($context, $event, $cut);
        if (! $others) {
            return false;
        }
        foreach ($others as $old) {
            $anchor = DB::table('edna_incoming_events')->find($old->anchor_entry_event_id);
            $previous = $this->decode($old->proof);
            $oldPayload = $anchor ? $this->authenticated($anchor) : null;
            if (! $oldPayload || ! $this->validAnchor($old, $oldPayload, $cut) || ! $this->validProof($previous, $anchor)
                || (string) $old->chat_id !== (string) $proof['chat_id'] || (string) $old->session_id !== (string) $proof['session_id']
                || (string) $previous['chat_id'] !== (string) $proof['chat_id'] || (string) $previous['session_id'] !== (string) $proof['session_id']
                || (int) $previous['message_id'] >= (int) $proof['message_id']
                || CarbonImmutable::parse($oldPayload['receivedAt'])->gt(CarbonImmutable::parse($payload['receivedAt']))) {
                return false;
            }
        }
        DB::table('web_chat_contexts')->whereIn('id', array_map(fn ($old) => $old->id, $others))->update([
            'state' => 'released', 'reason' => 'newer_explicit_reference_same_session', 'updated_at' => now(),
        ]);

        return true;
    }

    private function markAmbiguous(string $subject, string $hash, object $cut): void
    {
        $this->contexts($subject, $hash, $cut)->whereIn('state', ['waiting', 'bound'])
            ->update(['state' => 'review', 'reason' => 'web_context_multiple_submissions', 'updated_at' => now()]);
    }

    private function decode(mixed $value): array
    {
        try {
            $value = is_string($value) ? json_decode($value, true, 32, JSON_THROW_ON_ERROR) : $value;
        } catch (Throwable) {
            return [];
        }

        return is_array($value) ? $value : [];
    }

    private function result(string $status, string $reason, ?int $contextId = null): array
    {
        return ['status' => $status, 'reason' => $reason, 'context_id' => $contextId];
    }

    private function id(mixed $value): bool
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]{0,18}$/D', (string) $value) === 1;
    }
}
