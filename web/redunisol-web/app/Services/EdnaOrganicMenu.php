<?php

namespace App\Services;

use App\Jobs\ProcessEdnaOrganicMenu;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Durable organic intake: authenticated inbox capture, then bounded provider work. */
class EdnaOrganicMenu
{
    private EdnaBitrix $crm;

    private EdnaMessageBinding $binding;

    private EdnaOrganicTransport $transport;

    private EdnaOrganicAttention $attention;

    private int $menuId;

    private string $token;

    private float $deadline;

    private ?Lock $chatLock = null;

    public function __construct(?EdnaBitrix $crm = null, ?EdnaMessageBinding $binding = null,
        ?EdnaOrganicTransport $transport = null, ?EdnaOrganicAttention $attention = null)
    {
        $this->crm = $crm ?? app(EdnaBitrix::class);
        $this->binding = $binding ?? app(EdnaMessageBinding::class);
        $this->transport = $transport ?? app(EdnaOrganicTransport::class);
        $this->attention = $attention ?? app(EdnaOrganicAttention::class);
    }

    // Runs inside the inbox transaction. A token is an action, never a new entry.
    public function receiveChoice(object $event, array $payload): bool
    {
        return DB::transaction(fn () => $this->captureChoice($event, $payload));
    }

    private function captureChoice(object $event, array $payload): bool
    {
        $raw = $payload['messageContent']['payload'] ?? null;
        $reply = $payload['replyOutMessageExternalRequestId'] ?? null;
        $knownReply = is_string($reply) && Str::isUuid($reply)
            && DB::table('edna_organic_menus')->where('request_id', $reply)->exists();
        if ((! is_string($raw) || ! str_starts_with($raw, 'organic:')) && ! $knownReply) {
            return false;
        }
        $stored = $this->authenticatedPayload($event, $payload);
        $choice = $stored ? EdnaOrganicTransport::parseChoice($stored['messageContent']['payload'] ?? null) : null;
        if (! $choice || ($stored['messageContent']['type'] ?? '') === 'FLOW') {
            $this->record($event->id, 'organic_choice_unmatched');

            return true;
        }
        $menu = DB::table('edna_organic_menus')->where('request_id', $choice['request_id'])->lockForUpdate()->first();
        if (! $menu || ! $this->matchesChoice($menu, $event, $stored, false)
            || in_array($menu->state, ['duplicate', 'review', 'preserved', 'expired'], true)) {
            $this->record($event->id, 'organic_choice_unmatched');

            return true;
        }
        if ($menu->choice_event_id) {
            $this->record($event->id, (int) $menu->choice_event_id === (int) $event->id
                ? 'organic_choice_received' : 'organic_choice_duplicate');

            return true;
        }
        $claimed = DB::table('edna_organic_menus')->where('id', $menu->id)->whereNull('choice_event_id')->update([
            'choice_event_id' => $event->id, 'choice' => $choice['choice'],
            'choice_received_at' => CarbonImmutable::parse($stored['receivedAt']),
            'state' => 'selected', 'available_at' => now(), 'enqueued_at' => now(), 'updated_at' => now(),
        ]);
        if ($claimed) {
            Queue::connection('edna')->push(new ProcessEdnaOrganicMenu((int) $menu->id), '', 'edna');
        }
        $this->record($event->id, 'organic_choice_received');

        return true;
    }

    // Called only after explicit web continuations and proven reentries had priority.
    public function receiveEntry(object $event, array $payload): bool
    {
        return DB::transaction(fn () => $this->captureEntry($event, $payload));
    }

    private function captureEntry(object $event, array $payload): bool
    {
        $stored = $this->authenticatedPayload($event, $payload);
        if (! $stored || ! $this->eligible($event, $stored)) {
            return false;
        }
        $received = CarbonImmutable::parse($stored['receivedAt']);
        $phone = $stored['subscriber']['identifier'];
        $inserted = DB::table('edna_organic_menus')->insertOrIgnore([
            'request_id' => (string) Str::uuid(), 'entry_event_id' => $event->id,
            'subject_id' => $event->subject_id, 'cascade_id' => (string) config('edna.cascade_id'),
            'phone_hash' => (new AttributionJourney)->phoneHash($phone), 'recipient' => Crypt::encryptString($phone),
            'state' => 'pending', 'send_state' => 'pending', 'transfer_state' => 'pending',
            'entry_received_at' => $received, 'expires_at' => $received->addHours(24),
            'available_at' => now(), 'enqueued_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        if ($inserted) {
            $id = DB::table('edna_organic_menus')->where('entry_event_id', $event->id)->value('id');
            Queue::connection('edna')->push(new ProcessEdnaOrganicMenu((int) $id), '', 'edna');
        }
        $this->record($event->id, 'organic_menu_reserved');

        return true;
    }

    public function poll(int $limit = 25): int
    {
        $limit = max(1, min(25, $limit));

        return DB::transaction(function () use ($limit): int {
            $rows = DB::table('edna_organic_menus')->where(function ($query): void {
                $query->whereIn('state', ['pending', 'waiting', 'selected', 'unknown', 'route_pending'])
                    ->orWhere(fn ($q) => $q->where('state', 'awaiting_choice')->where(fn ($choice) => $choice
                        ->whereNotNull('choice_event_id')->orWhere('expires_at', '<=', now())));
            })->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->where(fn ($q) => $q->whereNull('enqueued_at')->orWhere('enqueued_at', '<=', now()->subMinute()))
                ->orderByRaw('COALESCE(available_at, created_at)')->orderBy('id')->limit($limit)->lockForUpdate()->get();
            foreach ($rows as $row) {
                DB::table('edna_organic_menus')->where('id', $row->id)->update(['enqueued_at' => now(), 'updated_at' => now()]);
                Queue::connection('edna')->push(new ProcessEdnaOrganicMenu((int) $row->id), '', 'edna');
            }

            return $rows->count();
        });
    }

    public function process(int $menuId): array
    {
        $this->menuId = $menuId;
        $this->deadline = microtime(true) + 90;
        $this->chatLock = null;
        $menu = $this->claim();
        if (! $menu) {
            return ['state' => 'not_claimed'];
        }
        $this->token = $menu->lease_token;
        try {
            $event = DB::table('edna_incoming_events')->find($menu->entry_event_id);
            $payload = $event ? $this->authenticatedPayload($event) : null;
            if (! $payload || ! $this->matchesMenu($menu, $event, $payload)) {
                return $this->finish('review', 'authenticated_entry_unavailable');
            }
            $uncertainTransfer = in_array($menu->transfer_state, ['sending', 'unknown'], true);
            $uncertainSend = in_array($menu->send_state, ['sending', 'accepted', 'unknown'], true);
            if (! $uncertainTransfer && ! $uncertainSend && ! $this->eligible($event, $payload, false)) {
                return $this->finish('waiting', 'organic_menu_disabled_or_outside_pilot');
            }
            $proof = $menu->proof ? json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR) : null;
            if (! $proof) {
                $this->assertBudget(35);
                $proof = $this->binding->resolve($event, $payload);
                if (! $proof) {
                    return $this->wait('native_message_pending');
                }
            }
            if (! $this->validProof($proof, $event)) {
                return $this->finish('review', 'native_proof_mismatch');
            }
            if (! $this->lockChat((string) $proof['chat_id'])) {
                return $this->wait('chat_routing_in_progress');
            }
            $other = DB::table('edna_organic_menus')->where('subject_id', $menu->subject_id)
                ->where('chat_id', $proof['chat_id'])->where('session_id', $proof['session_id'])->where('id', '!=', $menu->id)->first();
            if ($other) {
                return $this->finish('duplicate', 'menu_already_reserved_for_session', [
                    'canonical_menu_id' => $other->canonical_menu_id ?: $other->id,
                ]);
            }
            $this->write(['chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'],
                'proof' => json_encode($proof, JSON_THROW_ON_ERROR)]);
            $menu = $this->current();
            if ($uncertainTransfer) {
                return $this->reconcileTransfer($menu, $proof);
            }
            if ($uncertainSend) {
                $this->assertBudget(13);
                $result = $this->transport->reconcile($menu);
                $this->write($result);
                if ($result['send_state'] === 'confirmed') {
                    $menu = $this->current();

                    return $this->finish($menu->choice_event_id ? 'selected' : 'awaiting_choice', 'menu_outgoing_confirmed');
                }
                if ($result['send_state'] === 'rejected') {
                    return $this->finish('review', $result['send_reason'] ?? 'menu_outgoing_rejected');
                }

                return $this->wait('menu_outgoing_unconfirmed', ['send_state' => 'unknown'], true);
            }
            if (CarbonImmutable::parse($menu->expires_at)->isPast()) {
                return $this->finish('expired', 'conversation_window_elapsed');
            }
            if ($menu->send_state === 'pending') {
                return $this->send($menu, $proof);
            }
            if ($menu->send_state !== 'confirmed') {
                return $this->finish('review', 'menu_outgoing_not_confirmed');
            }
            if ($menu->state === 'route_pending') {
                return $this->transfer($menu, $proof, (int) $menu->seller_id);
            }
            if (! $menu->choice_event_id) {
                return $this->finish('awaiting_choice', 'menu_waiting_for_choice');
            }
            $choiceEvent = DB::table('edna_incoming_events')->find($menu->choice_event_id);
            $choicePayload = $choiceEvent ? $this->authenticatedPayload($choiceEvent) : null;
            if (! $choicePayload || ! $this->matchesChoice($menu, $choiceEvent, $choicePayload, true)) {
                return $this->finish('review', 'choice_context_mismatch');
            }
            $choiceProof = $proof['choice_proof'] ?? null;
            if (! $choiceProof) {
                $this->assertBudget(35);
                $choiceProof = $this->binding->resolve($choiceEvent, $choicePayload, (int) $proof['chat_id']);
            }
            if (! $choiceProof) {
                return $this->wait('native_choice_pending');
            }
            if (! $this->validProof($choiceProof, $choiceEvent)
                || (string) $choiceProof['chat_id'] !== (string) $proof['chat_id']
                || (string) $choiceProof['session_id'] !== (string) $proof['session_id']) {
                return $this->finish('preserved', 'choice_native_session_changed');
            }
            $proof['choice_proof'] = $choiceProof;
            $this->write(['proof' => json_encode($proof, JSON_THROW_ON_ERROR)]);
            if ($menu->choice === 'other') {
                return $this->transfer($menu, $proof, (int) config('edna.organic_other_operator_id', 5737));
            }
            if ($menu->choice !== 'loan') {
                return $this->finish('review', 'unsupported_menu_choice');
            }
            $this->assertBudget(35);
            $attention = $this->attention->inspectWelcome($proof);
            if (($attention['status'] ?? '') !== 'ready') {
                return $this->attentionDecision($attention);
            }

            return DB::transaction(function (): array {
                $result = $this->finish('loan_pending', 'loan_profile_pending', ['available_at' => now(), 'enqueued_at' => null]);
                if ($result['state'] === 'loan_pending') {
                    app(EdnaOrganicLoan::class)->enqueue($this->menuId);
                }

                return $result;
            });
        } catch (Throwable) {
            $current = $this->current();
            $transfer = in_array($current?->transfer_state, ['sending', 'unknown'], true);
            $send = in_array($current?->send_state, ['sending', 'accepted', 'unknown'], true);

            return $this->wait($transfer ? 'transfer_result_uncertain' : ($send ? 'menu_result_uncertain' : 'provider_reads_pending'),
                $transfer ? ['transfer_state' => 'unknown'] : ($send ? ['send_state' => 'unknown'] : []), $transfer || $send);
        } finally {
            try {
                $this->chatLock?->release();
            } catch (Throwable) {
                // Expiry releases a lost lock; no failed release can replay an effect.
            }
        }
    }

    private function send(object $menu, array $proof): array
    {
        if (CarbonImmutable::parse($menu->entry_received_at)->lt(now()->subHours(23))) {
            return $this->finish('expired', 'menu_send_window_elapsed');
        }
        $this->assertBudget(35);
        $attention = $this->attention->inspectWelcome($proof);
        if (($attention['status'] ?? '') !== 'ready') {
            return $this->attentionDecision($attention);
        }
        $this->assertBudget(13);
        $this->transport->assertChannel($menu);
        $this->assertBudget(35);
        $fresh = $this->attention->inspectWelcome($proof);
        if (($fresh['status'] ?? '') !== 'ready'
            || (string) ($fresh['owner_id'] ?? '') !== (string) ($attention['owner_id'] ?? '')
            || (string) ($fresh['session_id'] ?? '') !== (string) ($attention['session_id'] ?? '')) {
            return ($fresh['status'] ?? '') !== 'ready' ? $this->attentionDecision($fresh)
                : $this->finish('preserved', 'attention_changed_before_menu');
        }
        $current = $this->current();
        if ($current->send_state !== 'pending' || ! $this->enabled()) {
            return $this->wait('menu_send_gate_changed');
        }
        $this->assertBudget(13);
        $this->write(['send_state' => 'sending', 'send_started_at' => now()]);
        $this->assertLease();
        $result = $this->transport->schedule($this->current());
        $this->write($result);
        if ($result['send_state'] === 'rejected') {
            return $this->finish('review', $result['send_reason'] ?? 'menu_schedule_rejected');
        }

        return $this->finish($result['send_state'] === 'unknown' ? 'unknown' : 'waiting', 'menu_history_pending');
    }

    private function transfer(object $menu, array $proof, int $target): array
    {
        $this->assertBudget(6);
        if ($target < 1 || ! $this->attention->targetActive($target)) {
            return $this->finish('review', 'routing_target_unavailable');
        }
        $case = $this->commercialCase($menu, $target);
        if ($menu->state === 'route_pending' && $case === null) {
            return $this->finish('preserved', 'commercial_assignment_changed');
        }
        $this->assertBudget(65);
        $attention = $this->attention->inspect($proof, $target);
        if (($attention['status'] ?? '') === 'already_assigned') {
            return $this->finish('routed', 'already_with_target', ['transfer_state' => 'not_needed', 'seller_id' => (string) $target]);
        }
        if (($attention['status'] ?? '') !== 'ready') {
            return $this->attentionDecision($attention);
        }
        $before = $attention['native_snapshot'] ?? null;
        if (! is_array($before) || ! $this->attention->canTransfer($before, $target)) {
            return $this->finish('preserved', 'native_crm_assignment_preserved');
        }
        $this->assertBudget(65);
        $fresh = $this->attention->inspect($proof, $target);
        if (($fresh['status'] ?? '') !== 'ready') {
            return $this->attentionDecision($fresh);
        }
        $this->assertBudget(12);
        if (! is_array($fresh['native_snapshot'] ?? null)
            || ! $this->attention->compatible($before, $fresh['native_snapshot'], $target)
            || ! $this->attention->targetActive($target)
            || ($case !== null && $this->commercialCase($menu, $target) !== $case)) {
            return $this->finish('preserved', 'routing_context_changed');
        }
        $intent = ['target_id' => (string) $target, 'session_id' => (string) $proof['session_id'],
            'owner_before' => (string) $fresh['owner_id'], 'snapshot' => $fresh['native_snapshot'],
            'commercial_case' => $case, 'created_at' => now()->toIso8601String()];
        $this->assertBudget(6);
        $this->write(['transfer_state' => 'sending', 'transfer_intent' => json_encode($intent, JSON_THROW_ON_ERROR),
            'seller_id' => (string) $target, 'transfer_acknowledged' => false]);
        $this->assertLease();
        try {
            $ack = $this->crm->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $proof['chat_id'], 'USER_ID' => $target]);
            $this->write(['transfer_acknowledged' => $ack === true, 'transfer_state' => 'unknown']);
        } catch (Throwable) {
            $this->write(['transfer_state' => 'unknown']);
        }

        return $this->finish('unknown', 'transfer_confirmation_pending');
    }

    private function reconcileTransfer(object $menu, array $proof): array
    {
        $intent = $menu->transfer_intent ? json_decode($menu->transfer_intent, true, 32, JSON_THROW_ON_ERROR) : null;
        if (! is_array($intent) || ! $this->positiveId($intent['target_id'] ?? null)
            || ! is_array($intent['snapshot'] ?? null)
            || ! array_key_exists('commercial_case', $intent)
            || (string) ($intent['session_id'] ?? '') !== (string) $proof['session_id']) {
            return $this->finish('review', 'transfer_intent_unavailable', ['transfer_state' => 'unknown']);
        }
        $this->assertBudget(6);
        $dialog = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $proof['chat_id']]);
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        if (! is_array($dialog) || (string) ($dialog['id'] ?? '') !== (string) $proof['chat_id']
            || (string) ($parts[5] ?? '') !== (string) $proof['session_id']
            || ! in_array($dialog['text_field_enabled'] ?? null, [true, 'Y', 1, '1'], true)) {
            return $this->finish('preserved', 'session_changed_after_transfer', ['transfer_state' => 'unknown']);
        }
        $owner = (string) ($dialog['owner'] ?? 0);
        $target = (int) $intent['target_id'];
        if ($owner === (string) $target) {
            $this->assertBudget(30);
            $after = $this->attention->snapshot($proof);
            if (! $this->attention->compatible($intent['snapshot'], $after, $target, true)
                || ($intent['commercial_case'] !== null && $this->commercialCase($menu, $target, true) !== $intent['commercial_case'])) {
                return $this->finish('review', 'crm_changed_after_transfer', ['transfer_state' => 'observed']);
            }

            return $this->finish('routed', $menu->transfer_acknowledged ? 'target_confirmed' : 'target_observed_after_uncertain_post',
                ['transfer_state' => $menu->transfer_acknowledged ? 'confirmed' : 'observed']);
        }
        if (! in_array($owner, ['0', '', (string) $intent['owner_before']], true)) {
            return $this->finish('preserved', 'human_assignment_after_transfer', ['transfer_state' => 'unknown']);
        }

        return $this->wait('transfer_result_uncertain', ['transfer_state' => 'unknown'], true);
    }

    private function commercialCase(object $menu, int $target, bool $required = false): ?array
    {
        if ($menu->state !== 'route_pending' && ! $required) {
            return null;
        }
        try {
            $evidence = json_decode($menu->profile_evidence ?? '', true, 32, JSON_THROW_ON_ERROR);
            $assigned = $evidence['assigned_case'] ?? null;
            $profile = json_decode(Crypt::decryptString($menu->profile_snapshot ?? ''), true, 32, JSON_THROW_ON_ERROR);
            $identity = is_array($profile) && is_string($profile['cuil'] ?? null)
                ? (new WebFormReceipt)->identityHash($profile['cuil']) : null;
        } catch (Throwable) {
            return null;
        }
        if (! is_array($assigned) || ! $this->positiveId($menu->deal_id)
            || ! $this->positiveId($assigned['deal_id'] ?? null) || ! $this->positiveId($assigned['seller_id'] ?? null)
            || (string) ($assigned['deal_id'] ?? '') !== (string) $menu->deal_id
            || (string) ($assigned['seller_id'] ?? '') !== (string) $target
            || ! $this->positiveId($assigned['contact_id'] ?? null)
            || ! array_key_exists('lead_id', $assigned)
            || ! is_string($assigned['profile_identity_hash'] ?? null) || ! $identity
            || ! hash_equals($identity, $assigned['profile_identity_hash'])) {
            return null;
        }
        $contactId = (string) $assigned['contact_id'];
        $emptyLead = in_array($assigned['lead_id'], ['', '0', 0, null], true);
        if (! $emptyLead && ! $this->positiveId($assigned['lead_id'])) {
            return null;
        }
        $leadId = $emptyLead ? '' : (string) $assigned['lead_id'];
        $this->assertBudget(6);
        $deal = $this->crm->call('crm.deal.get', ['id' => $menu->deal_id]);
        if (! is_array($deal)) {
            return null;
        }
        $currentLead = in_array($deal['LEAD_ID'] ?? null, ['', '0', 0, null], true) ? '' : (string) $deal['LEAD_ID'];
        if ((string) ($deal['ID'] ?? '') !== (string) $menu->deal_id
            || (string) ($deal['ASSIGNED_BY_ID'] ?? '') !== (string) $target
            || (string) ($deal['CONTACT_ID'] ?? '') !== $contactId || $currentLead !== $leadId
            || (int) ($deal['CATEGORY_ID'] ?? -1) !== 1 || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P') {
            return null;
        }
        foreach (['contact' => [$contactId, 'UF_CRM_65B7E48033FCD'], 'lead' => [$leadId, 'UF_CRM_1693840106704']] as $entity => [$id, $field]) {
            if ($id === '') {
                continue;
            }
            $this->assertBudget(6);
            $record = $this->crm->call('crm.'.$entity.'.get', ['id' => $id]);
            if (! is_array($record) || (string) ($record['ID'] ?? '') !== $id
                || ! is_string($record[$field] ?? null)
                || ! hash_equals($identity, (new WebFormReceipt)->identityHash($record[$field]) ?? '')
                || ($entity === 'lead' && ! in_array($record['CONTACT_ID'] ?? null, ['', '0', 0, null], true)
                    && (string) $record['CONTACT_ID'] !== $contactId)) {
                return null;
            }
        }

        $snapshot = [];
        foreach (['ID', 'ASSIGNED_BY_ID', 'LEAD_ID', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID'] as $field) {
            $snapshot[$field] = (string) ($deal[$field] ?? '');
        }
        $snapshot['LEAD_ID'] = $leadId;
        $snapshot['profile_identity_hash'] = $identity;

        return $snapshot;
    }

    private function matchesChoice(object $menu, object $event, array $payload, bool $confirmed): bool
    {
        try {
            $choice = EdnaOrganicTransport::parseChoice($payload['messageContent']['payload'] ?? null);
            $received = CarbonImmutable::parse($payload['receivedAt']);

            return $choice !== null && $choice['request_id'] === $menu->request_id
                && (! $menu->choice || $choice['choice'] === $menu->choice)
                && $this->matchesMenu($menu, $event, $payload)
                && $menu->send_started_at && in_array($menu->send_state, ['sending', 'accepted', 'unknown', 'confirmed'], true)
                && (! $confirmed || $menu->send_state === 'confirmed')
                && $received->gte(CarbonImmutable::parse($menu->send_started_at)->subMinute())
                && $received->lte(CarbonImmutable::parse($menu->expires_at))
                && $received->lte(now()->addMinutes(5))
                && (! isset($payload['replyOutMessageExternalRequestId']) || $payload['replyOutMessageExternalRequestId'] === $menu->request_id)
                && (! isset($payload['replyOutMessageId']) || ! $menu->outgoing_message_id
                    || $payload['replyOutMessageId'] === $menu->outgoing_message_id)
                && (! $confirmed || ! isset($payload['replyOutMessageId']) || $payload['replyOutMessageId'] === $menu->outgoing_message_id);
        } catch (Throwable) {
            return false;
        }
    }

    private function matchesMenu(object $menu, object $event, array $payload): bool
    {
        try {
            $phone = $payload['subscriber']['identifier'];

            return $menu->subject_id === $event->subject_id && $menu->subject_id === (string) config('edna.subject_id')
                && $menu->cascade_id === (string) config('edna.cascade_id')
                && Str::isUuid($menu->request_id) && hash_equals(Crypt::decryptString($menu->recipient), $phone)
                && hash_equals($menu->phone_hash, (new AttributionJourney)->phoneHash($phone) ?? '');
        } catch (Throwable) {
            return false;
        }
    }

    private function authenticatedPayload(object $event, ?array $provided = null): ?array
    {
        try {
            $stored = json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
            $phone = $stored['subscriber']['identifier'] ?? null;
            if (! is_array($stored) || ! is_string($phone) || ! preg_match('/^[0-9]{10,15}$/D', $phone)
                || $event->subject_id !== (string) config('edna.subject_id')
                || ($stored['subjectId'] ?? null) !== $event->subject_id || ($stored['id'] ?? null) !== $event->message_id
                || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', (string) ($stored['receivedAt'] ?? ''))
                || ($provided !== null && (($provided['id'] ?? null) !== $stored['id']
                    || ($provided['subjectId'] ?? null) !== $stored['subjectId']
                    || ($provided['subscriber']['identifier'] ?? null) !== $phone))) {
                return null;
            }
            CarbonImmutable::parse($stored['receivedAt']);

            return $stored;
        } catch (Throwable) {
            return null;
        }
    }

    private function enabled(): bool
    {
        return config('edna.enabled') && config('edna.router_enabled') && config('edna.intake_enabled') && config('edna.organic_menu_enabled');
    }

    private function eligible(object $event, array $payload, bool $entryWindow = true): bool
    {
        if (! $this->enabled() || ! (new EdnaIntake)->salesChannelEntry($event, $payload)
            || ! preg_match('/^[1-9][0-9]{0,63}$/D', (string) config('edna.cascade_id'))) {
            return false;
        }
        $start = config('edna.organic_menu_start_at');
        if (! is_string($start) || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $start)) {
            return false;
        }
        try {
            $received = CarbonImmutable::parse($payload['receivedAt']);
            if ($received->lt(CarbonImmutable::parse($start)) || $received->gt(now()->addMinutes(5))
                || ($entryWindow && $received->lt(now()->subHours(23)))) {
                return false;
            }
        } catch (Throwable) {
            return false;
        }
        foreach (['router_recipients', 'intake_recipients', 'organic_menu_recipients'] as $name) {
            $allowed = config('edna.'.$name, []);
            if (! is_array($allowed) || ($allowed && ! in_array($payload['subscriber']['identifier'], $allowed, true))) {
                return false;
            }
        }

        return true;
    }

    private function validProof(array $proof, object $event): bool
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id'
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $event->id
            || (string) ($proof['entry_message_id'] ?? '') !== (string) $event->message_id) {
            return false;
        }
        foreach (['chat_id', 'session_id', 'activity_id', 'message_id'] as $field) {
            if (! $this->positiveId($proof[$field] ?? null)) {
                return false;
            }
        }

        return true;
    }

    private function lockChat(string $chat): bool
    {
        $store = Cache::getStore();
        if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
            return false;
        }
        $lock = Cache::lock('web-form-chat:'.$chat, 120, $this->token);
        if (! $lock->get()) {
            return false;
        }
        $this->chatLock = $lock;

        return true;
    }

    private function claim(): ?object
    {
        return DB::transaction(function (): ?object {
            $row = $this->current(true);
            if (! $row || ! in_array($row->state, ['pending', 'waiting', 'selected', 'unknown', 'route_pending', 'awaiting_choice'], true)
                || ($row->lease_until && CarbonImmutable::parse($row->lease_until)->isFuture())
                || ($row->available_at && CarbonImmutable::parse($row->available_at)->isFuture())
                || ($row->state === 'awaiting_choice' && ! $row->choice_event_id && CarbonImmutable::parse($row->expires_at)->isFuture())) {
                return null;
            }
            DB::table('edna_organic_menus')->where('id', $this->menuId)->update([
                'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addSeconds(120),
                'attempts' => $row->attempts + 1, 'enqueued_at' => null, 'updated_at' => now(),
            ]);

            return $this->current();
        });
    }

    private function current(bool $lock = false): ?object
    {
        return DB::table('edna_organic_menus')->where('id', $this->menuId)->when($lock, fn ($q) => $q->lockForUpdate())->first();
    }

    private function assertLease(): void
    {
        if (microtime(true) >= $this->deadline || ! DB::table('edna_organic_menus')->where('id', $this->menuId)
            ->where('lease_token', $this->token)->where('lease_until', '>', now())->exists()) {
            throw new RuntimeException('Organic menu lease expired.');
        }
    }

    private function assertBudget(int $seconds): void
    {
        $this->assertLease();
        if (microtime(true) + $seconds >= $this->deadline) {
            throw new RuntimeException('Organic menu read phase deferred.');
        }
    }

    private function write(array $fields): void
    {
        $this->assertLease();
        if (DB::table('edna_organic_menus')->where('id', $this->menuId)->where('lease_token', $this->token)
            ->update($fields + ['updated_at' => now()]) !== 1) {
            throw new RuntimeException('Organic menu lease superseded.');
        }
    }

    private function wait(string $reason, array $fields = [], bool $unknown = false): array
    {
        return $this->finish(($this->current()?->attempts ?? 12) >= 12 ? 'review' : ($unknown ? 'unknown' : 'waiting'), $reason, $fields);
    }

    private function attentionDecision(array $attention): array
    {
        if (($attention['status'] ?? '') === 'waiting') {
            return $this->wait($attention['reason'] ?? 'attention_unavailable');
        }

        return $this->finish('preserved', $attention['reason'] ?? 'human_attention_preserved', ['transfer_state' => 'preserved']);
    }

    private function finish(string $state, string $reason, array $fields = []): array
    {
        $updated = DB::table('edna_organic_menus')->where('id', $this->menuId)->where('lease_token', $this->token)->update($fields + [
            'state' => $state, 'reason' => $reason, 'lease_token' => null, 'lease_until' => null,
            'available_at' => now()->addSeconds($state === 'unknown' ? 120 : 60), 'updated_at' => now(),
        ]);
        if ($updated !== 1) {
            return ['state' => 'superseded', 'reason' => 'menu_lease_superseded'];
        }
        try {
            $row = $this->current();
            app(JourneyLedger::class)->record('whatsapp.organic_menu', [
                'menu_id' => $row->id, 'request_id' => $row->request_id, 'entry_event_id' => $row->entry_event_id,
                'choice_event_id' => $row->choice_event_id, 'chat_id' => $row->chat_id, 'native_session_id' => $row->session_id,
                'state' => $state, 'reason' => $reason, 'choice' => $row->choice, 'send_state' => $row->send_state,
                'outgoing_message_id' => $row->outgoing_message_id, 'flow_send_id' => $row->flow_send_id,
                'seller_id' => $row->seller_id, 'transfer_state' => $row->transfer_state,
                'transfer_acknowledged' => (bool) $row->transfer_acknowledged,
            ], array_filter(['deal_id' => $row->deal_id, 'case_id' => $row->case_id]), 'whatsapp.organic');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) {
            // Tracking cannot reset a durable or uncertain provider operation.
        }

        return ['state' => $state, 'reason' => $reason];
    }

    private function record(int $eventId, string $action): void
    {
        DB::table('edna_incoming_events')->where('id', $eventId)->update(['router_action' => $action]);
    }

    private function positiveId(mixed $value): bool
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value) === 1;
    }
}
