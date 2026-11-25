<?php

namespace App\Services;

use App\Jobs\RouteEdnaBenefitsChat;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Routes fresh, exactly proved replies to their Benefits deal owner without CRM edits. */
class EdnaBenefitsRouting
{
    public const NAME = 'benefits-chat-routing-v1';

    private ?object $row = null;

    private float $deadline = 0;

    public function __construct(private ?EdnaBitrix $crm = null, private ?EdnaBenefitsCase $cases = null, private ?WebFormChatGuard $guard = null)
    {
        $this->crm ??= new EdnaBitrix;
        $this->cases ??= new EdnaBenefitsCase($this->crm);
        $this->guard ??= new WebFormChatGuard($this->crm);
    }

    public function eligibleEntry(object $event): bool
    {
        return $this->entry($event) !== null;
    }

    /** Null permits the credit path. A durable Benefits route owns this callback independently. */
    public function check(object $event, array $proof): ?array
    {
        $payload = $this->entry($event);
        if (! $payload) {
            return null;
        }
        $proof = $this->proof($event, $proof);
        if (! $proof) {
            return ['state' => 'review', 'reason' => 'benefits_native_proof_unverified'];
        }
        $priorEntry = DB::table('edna_benefit_chat_routes')->where('entry_event_id', $event->id)->first(['chat_id', 'session_id']);
        if ($priorEntry && ((string) $priorEntry->chat_id !== $proof['chat_id'] || (string) $priorEntry->session_id !== $proof['session_id'])) {
            return ['state' => 'review', 'reason' => 'benefits_native_proof_changed'];
        }
        $existing = DB::table('edna_benefit_chat_routes')->where('chat_id', $proof['chat_id'])->where('session_id', $proof['session_id'])->first();
        if ($existing) {
            DB::table('edna_benefit_chat_routes')->where('entry_event_id', $existing->entry_event_id)
                ->where('last_entry_event_id', '<', $event->id)->update(['last_entry_event_id' => $event->id]);
            $stored = json_decode($existing->proof, true);
            foreach ((int) $existing->entry_event_id === (int) $event->id
                ? ['chat_id', 'session_id', 'message_id', 'activity_id', 'entry_message_id'] : ['chat_id', 'session_id'] as $key) {
                if (($stored[$key] ?? null) !== $proof[$key]) {
                    return ['state' => 'review', 'reason' => 'benefits_native_proof_changed'];
                }
            }
            if ($existing->campaign_reply || ($existing->case_snapshot && $existing->state !== 'not_applicable') || ! in_array($existing->state, ['pending', 'waiting', 'not_applicable'], true)) {
                return $this->blocking($existing);
            }
            if ($existing->lease_until && CarbonImmutable::parse($existing->lease_until)->isFuture()) {
                return ['state' => 'waiting', 'reason' => 'benefits_classification_pending'];
            }
            if ($existing->state === 'waiting' && $existing->available_at && CarbonImmutable::parse($existing->available_at)->isFuture()) {
                return ['state' => 'waiting', 'reason' => 'benefits_classification_pending'];
            }
        }
        try {
            $decision = $this->cases->resolve($proof);
        } catch (Throwable) {
            $decision = ['status' => 'waiting', 'reason' => 'benefits_case_reads_pending'];
        }
        if (($decision['status'] ?? '') === 'not_applicable') {
            if ($existing) {
                DB::table('edna_benefit_chat_routes')->where('entry_event_id', $existing->entry_event_id)->whereNull('transfer_intent')
                    ->whereNull('lease_token')->whereNull('campaign_reply')->update(['state' => 'not_applicable', 'reason' => 'benefits_not_applicable', 'updated_at' => now()]);
            }

            // Campaign evidence can arrive while the CRM case read is in flight.
            $campaign = DB::table('edna_benefit_chat_routes')->where('chat_id', $proof['chat_id'])
                ->where('session_id', $proof['session_id'])->whereNotNull('campaign_reply')->first();
            if ($campaign) {
                return $this->blocking($campaign);
            }

            return null;
        }
        $benefits = ($decision['status'] ?? '') === 'benefits';
        $transient = ($decision['reason'] ?? '') === 'native_benefits_case_unverified';
        $state = $benefits ? 'pending' : (($decision['status'] ?? '') === 'review' && ! $transient ? 'review' : 'waiting');
        $received = CarbonImmutable::parse($payload['receivedAt'])->utc();

        return DB::transaction(function () use ($event, $proof, $decision, $benefits, $state, $received): array {
            DB::table('edna_benefit_chat_routes')->insertOrIgnore([
                'entry_event_id' => $event->id, 'last_entry_event_id' => $event->id, 'chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'],
                'proof' => json_encode($proof, JSON_THROW_ON_ERROR), 'received_at' => $received,
                'expires_at' => $received->addHours(8), 'state' => 'waiting', 'available_at' => now(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $row = DB::table('edna_benefit_chat_routes')->where('chat_id', $proof['chat_id'])->where('session_id', $proof['session_id'])->lockForUpdate()->first();
            if (! $row->campaign_reply && ! $row->case_snapshot && ! $row->transfer_intent && ! $row->lease_token) {
                DB::table('edna_benefit_chat_routes')->where('entry_event_id', $row->entry_event_id)->update([
                    'state' => $state, 'reason' => $benefits ? 'benefits_route_reserved' : ($decision['reason'] ?? 'benefits_classification_pending'),
                    'case_snapshot' => $benefits ? json_encode($decision, JSON_THROW_ON_ERROR) : null,
                    'deal_id' => $benefits ? $decision['case']['deal_id'] : null,
                    'target_id' => $benefits ? $decision['case']['responsible_id'] : null, 'updated_at' => now(),
                ]);
            }
            $row = DB::table('edna_benefit_chat_routes')->where('entry_event_id', $row->entry_event_id)->first();
            if (in_array($row->state, ['pending', 'waiting'], true)) {
                app(EdnaWorkQueue::class)->push(new RouteEdnaBenefitsChat((int) $row->entry_event_id));
            }

            return $this->blocking($row);
        });
    }

    /** Reserve the session for a verified campaign click, even when it has only a CRM contact. */
    public function reserveMemberButton(object $event, array $nativeProof, array $outbound): array
    {
        $payload = $this->entry($event);
        $proof = $this->proof($event, $nativeProof);
        if (! $proof || ! $payload || ! app(EdnaFreshIntake::class)->entry($event, EdnaMemberBenefitsButton::CUTOVER)
            || ! app(EdnaMemberBenefitsButton::class)->candidate($payload)
            || ($outbound['messageId'] ?? null) !== (string) $payload['replyOutMessageId']
            || ($outbound['matcherId'] ?? null) !== EdnaMemberBenefitsButton::MATCHER
            || ($outbound['subjectId'] ?? null) !== (string) $event->subject_id) {
            return ['state' => 'review', 'reason' => 'member_benefits_evidence_unverified'];
        }
        $received = CarbonImmutable::parse($payload['receivedAt'])->utc();

        return DB::transaction(function () use ($event, $proof, $outbound, $received): array {
            $routes = DB::table('edna_benefit_chat_routes');
            $routes->insertOrIgnore([
                'entry_event_id' => $event->id, 'last_entry_event_id' => $event->id,
                'chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'],
                'proof' => json_encode($proof, JSON_THROW_ON_ERROR), 'received_at' => $received,
                'expires_at' => $received->addHours(8), 'state' => 'pending', 'available_at' => now(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $row = $routes->where('chat_id', $proof['chat_id'])->where('session_id', $proof['session_id'])->lockForUpdate()->first();
            if (! $row || ($row->entry_event_id != $event->id
                && DB::table('edna_benefit_chat_routes')->where('entry_event_id', $event->id)->exists())) {
                return ['state' => 'review', 'reason' => 'benefits_native_proof_changed'];
            }
            if ($row->campaign_reply || $row->transfer_intent || in_array($row->state, ['preserved', 'routed', 'sending', 'unknown'], true)) {
                return ['state' => 'preserved', 'reason' => 'benefits_routing'];
            }
            if ($row->lease_until && CarbonImmutable::parse($row->lease_until)->isFuture()) {
                return ['state' => 'waiting', 'reason' => 'benefits_classification_pending'];
            }
            DB::table('edna_benefit_chat_routes')->where('entry_event_id', $row->entry_event_id)->update([
                'last_entry_event_id' => max((int) $event->id, (int) $row->last_entry_event_id),
                'campaign_reply' => json_encode(['outbound' => $outbound, 'proof' => $proof], JSON_THROW_ON_ERROR),
                'target_id' => EdnaMemberBenefitsButton::OPERATOR, 'case_snapshot' => null, 'deal_id' => null,
                'state' => 'pending', 'reason' => 'member_benefits_button_verified', 'available_at' => now(),
                'lease_token' => null, 'lease_until' => null, 'transfer_state' => 'pending',
                'received_at' => $received, 'expires_at' => $received->addHours(8), 'updated_at' => now(),
            ]);
            app(EdnaWorkQueue::class)->push(new RouteEdnaBenefitsChat((int) $row->entry_event_id));

            return ['state' => 'preserved', 'reason' => 'benefits_routing'];
        });
    }

    public function poll(int $limit = 25): int
    {
        if (! $this->enabled() || ! Schema::hasTable('edna_benefit_chat_routes')) {
            return 0;
        }
        $cut = DB::table('edna_intake_cutovers')->where('name', self::NAME)->first();
        if (! $cut) {
            return 0;
        }

        return DB::transaction(function () use ($limit, $cut): int {
            $queue = app(EdnaWorkQueue::class);
            $rows = $queue->withoutPending(DB::table('edna_benefit_chat_routes'), RouteEdnaBenefitsChat::class, 'edna_benefit_chat_routes.entry_event_id')
                ->whereIn('state', ['pending', 'waiting', 'sending', 'unknown'])
                ->where('entry_event_id', '>', $cut->entry_id_after)->where('received_at', '>=', $cut->starts_at)
                ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->orderByRaw('CASE WHEN attempts = 0 THEN 0 ELSE 1 END')->orderBy('available_at')->orderBy('entry_event_id')
                ->limit(min(100, max(1, $limit)))->lockForUpdate()->get();
            $count = 0;
            foreach ($rows as $row) {
                $count += (int) $queue->push(new RouteEdnaBenefitsChat((int) $row->entry_event_id));
            }

            return $count;
        });
    }

    public function process(int $entryId): array
    {
        $this->row = null;
        if (! $this->enabled()) {
            return ['state' => 'disabled'];
        }
        $this->deadline = microtime(true) + 90;
        $this->row = DB::transaction(function () use ($entryId): ?object {
            $row = DB::table('edna_benefit_chat_routes')->where('entry_event_id', $entryId)->lockForUpdate()->first();
            if (! $row || ! in_array($row->state, ['pending', 'waiting', 'sending', 'unknown'], true)
                || ($row->lease_until && CarbonImmutable::parse($row->lease_until)->isFuture())
                || ($row->available_at && CarbonImmutable::parse($row->available_at)->isFuture())) {
                return null;
            }
            $row->lease_token = (string) Str::uuid();
            $row->attempts++;
            DB::table('edna_benefit_chat_routes')->where('entry_event_id', $entryId)->update([
                'lease_token' => $row->lease_token, 'lease_until' => now()->addSeconds(120),
                'attempts' => $row->attempts, 'updated_at' => now(),
            ]);

            return $row;
        });
        if (! $this->row) {
            return ['state' => 'not_claimed'];
        }
        $lock = null;
        try {
            $this->assertLease();
            $campaign = $this->row->campaign_reply ? json_decode($this->row->campaign_reply, true, 32, JSON_THROW_ON_ERROR) : null;
            $proof = $campaign['proof'] ?? json_decode($this->row->proof, true, 32, JSON_THROW_ON_ERROR);
            $event = DB::table('edna_incoming_events')->find($campaign['proof']['entry_event_id'] ?? $entryId);
            if (! $event || ! $this->entry($event) || ! $this->proof($event, $proof)
                || (string) $this->row->chat_id !== $proof['chat_id'] || (string) $this->row->session_id !== $proof['session_id']) {
                $this->decide('review', 'benefits_entry_no_longer_eligible');
            }
            $store = Cache::getStore();
            if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
                $this->decide('waiting', 'shared_chat_lock_unavailable');
            }
            $lock = Cache::lock('web-form-chat:'.$this->row->chat_id, 120, $this->row->lease_token);
            if (! $lock->get()) {
                $this->decide('waiting', 'chat_work_in_progress');
            }
            if ($this->row->transfer_intent) {
                return $this->reconcile($proof);
            }
            if (in_array($this->row->state, ['sending', 'unknown'], true)) {
                $this->decide('review', 'benefits_transfer_receipt_incomplete');
            }
            $before = $campaign === null ? $this->currentCase($proof) : null;
            $target = $before === null ? EdnaMemberBenefitsButton::OPERATOR : (string) $before['case']['responsible_id'];
            $this->activeTarget($target);
            if ($before !== null) {
                $this->write(['case_snapshot' => json_encode($before, JSON_THROW_ON_ERROR), 'deal_id' => $before['case']['deal_id'], 'target_id' => $target]);
            }
            $attention = $this->guard->inspect($proof, $target);
            if (($attention['status'] ?? '') === 'already_assigned') {
                return $this->observedOwner($proof, $before);
            }
            $this->attention($attention);
            $fresh = $before === null ? null : $this->currentCase($proof);
            if ($before !== null && ! $this->cases->compatible($before, $fresh, false)) {
                $this->decide('preserved', 'benefits_case_changed');
            }
            $this->activeTarget($target);
            $attention = $this->guard->inspect($proof, $target);
            if (($attention['status'] ?? '') === 'already_assigned') {
                return $this->observedOwner($proof, $fresh);
            }
            $this->attention($attention);
            if ($fresh !== null && ! $this->matchesDialog($fresh['snapshot']['dialog_tuple'] ?? [], $attention['dialog'] ?? null)) {
                $this->decide('preserved', 'benefits_native_dialog_changed');
            }
            $intent = ['entry_event_id' => (int) $event->id, 'entry_message_id' => $proof['entry_message_id'],
                'chat_id' => (int) $this->row->chat_id, 'session_id' => (int) $this->row->session_id,
                'deal_id' => $this->row->deal_id === null ? null : (string) $this->row->deal_id, 'target_id' => $target,
                'owner_before' => (int) $attention['owner_id'], 'actor_id' => $this->actor(), 'created_at' => now()->utc()->toIso8601String()];
            $this->write(['case_snapshot' => $fresh === null ? null : json_encode($fresh, JSON_THROW_ON_ERROR),
                'transfer_intent' => json_encode($intent, JSON_THROW_ON_ERROR),
                'state' => 'sending', 'transfer_state' => 'sending']);
            $this->assertLease();
            try {
                $ack = $this->crm->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $this->row->chat_id, 'USER_ID' => (int) $target]);
                if ($ack === true) {
                    if (DB::table('edna_benefit_chat_routes')->where('entry_event_id', $entryId)->where('lease_token', $this->row->lease_token)
                        ->where('lease_until', '>', now())->update(['transfer_acknowledged' => true, 'updated_at' => now()]) === 1) {
                        $this->row->transfer_acknowledged = true;
                    }
                }
            } catch (Throwable) {
                // The durable intent prevents a timed-out POST from being repeated.
            }

            return $this->reconcile($proof);
        } catch (EdnaBenefitsDecision $decision) {
            return $this->finish($decision->state, $decision->reason);
        } catch (Throwable) {
            return $this->finish($this->row->transfer_intent ? 'unknown' : 'waiting',
                $this->row->transfer_intent ? 'benefits_transfer_uncertain' : 'benefits_reads_pending');
        } finally {
            try {
                $lock?->release();
            } catch (Throwable) {
                // Shared locks expire; their failure never authorizes another POST.
            }
        }
    }

    private function observedOwner(array $proof, ?array $case): array
    {
        if ($case !== null && ! $this->cases->compatible($case, $this->currentCase($proof), true)) {
            $this->decide('preserved', 'benefits_case_changed');
        }

        return $this->finish('routed', 'benefits_owner_already_observed', ['transfer_state' => 'not_needed']);
    }

    private function reconcile(array $proof): array
    {
        $intent = json_decode($this->row->transfer_intent, true, 16, JSON_THROW_ON_ERROR);
        $dialog = $this->read('imopenlines.dialog.get', ['CHAT_ID' => (int) $this->row->chat_id]);
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        if ((string) ($dialog['id'] ?? '') !== (string) $this->row->chat_id || ($dialog['entity_type'] ?? '') !== 'LINES'
            || (string) ($parts[5] ?? '') !== (string) $this->row->session_id) {
            return $this->finish('preserved', 'benefits_session_changed_after_post', ['transfer_state' => 'unknown']);
        }
        $native = $this->nativeTransfer($intent);
        $confirmed = $this->row->transfer_acknowledged && $native !== null;
        $fields = ['transfer_state' => $confirmed ? 'confirmed' : 'unknown', 'native_transfer' => $native ? json_encode($native, JSON_THROW_ON_ERROR) : null];
        $owner = (string) ($dialog['owner'] ?? '');
        if ($owner !== (string) $intent['target_id']) {
            if ($owner !== (string) $intent['owner_before'] && $owner !== '0') {
                return $this->finish('preserved', 'benefits_human_assignment_after_post', $fields);
            }

            return $this->finish('unknown', 'benefits_transfer_not_yet_observed', $fields);
        }
        if (! $this->row->campaign_reply) {
            $after = $this->currentCase($proof);
            $before = json_decode($this->row->case_snapshot, true, 32, JSON_THROW_ON_ERROR);
            if (! $this->cases->compatible($before, $after, true)) {
                return $this->finish('review', 'benefits_case_changed_after_transfer', $fields);
            }
        }
        if (! $this->row->transfer_acknowledged) {
            return $this->finish('routed', 'benefits_target_observed_after_uncertain_post', array_replace($fields, ['transfer_state' => 'observed']));
        }

        return $this->finish($confirmed ? 'routed' : 'unknown', $confirmed ? 'benefits_transfer_confirmed' : 'benefits_native_confirmation_pending', $fields);
    }

    private function nativeTransfer(array $intent): ?array
    {
        $stats = $this->read('imopenlines.v2.Session.Stat.get', ['sessionId' => [(int) $this->row->session_id]]);
        $sessions = $stats['sessions'] ?? null;
        if (! is_array($sessions) || ! array_is_list($sessions) || count($sessions) !== 1
            || (string) ($sessions[0]['sessionId'] ?? '') !== (string) $this->row->session_id
            || is_bool($sessions[0]['transfersCount'] ?? null)
            || filter_var($sessions[0]['transfersCount'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]) === false) {
            $this->decide('unknown', 'benefits_transfer_history_incomplete');
        }
        $data = $this->read('imopenlines.v2.Session.Transfer.list', ['sessionId' => [(int) $this->row->session_id]]);
        $rows = $data['transfers'] ?? null;
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) < (int) $sessions[0]['transfersCount']
            || count($rows) >= 1000 || ($data['hasNextPage'] ?? false) !== false) {
            $this->decide('unknown', 'benefits_transfer_history_incomplete');
        }
        $matches = [];
        $created = CarbonImmutable::parse($intent['created_at']);
        foreach ($rows as $transfer) {
            if (! is_array($transfer) || (string) ($transfer['sessionId'] ?? '') !== (string) $intent['session_id']) {
                $this->decide('unknown', 'benefits_transfer_history_inconsistent');
            }
            if (! is_string($transfer['date'] ?? null) || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $transfer['date'])) {
                $this->decide('unknown', 'benefits_transfer_date_unverified');
            }
            $at = CarbonImmutable::parse($transfer['date']);
            if ((string) ($transfer['toOperatorId'] ?? '') !== (string) $intent['target_id']
                || ! array_key_exists('fromOperatorId', $transfer) || (string) $transfer['fromOperatorId'] !== (string) $intent['actor_id']
                || (string) ($transfer['fromConfigId'] ?? '') !== '1' || ! in_array($transfer['toConfigId'] ?? null, [null, 1, '1'], true)
                || ($transfer['type'] ?? '') !== 'USER' || ($transfer['mode'] ?? '') !== 'MANUAL'
                || (string) ($transfer['initiatorId'] ?? '') !== (string) $intent['actor_id']
                || (isset($transfer['chatId']) && (string) $transfer['chatId'] !== (string) $intent['chat_id'])
                || $at->lt($created) || $at->gt($created->addMinutes(2)) || $at->gt(now()->addSeconds(5))) {
                continue;
            }
            $tuple = ['chat_id' => (int) $intent['chat_id'], 'session_id' => (int) $intent['session_id'],
                'from_operator_id' => (int) ($transfer['fromOperatorId'] ?? 0), 'target_id' => (int) $transfer['toOperatorId'],
                'from_config_id' => 1, 'date' => $at->utc()->toIso8601String(), 'initiator_id' => $transfer['initiatorId'] ?? null];
            $tuple['sha256'] = hash('sha256', json_encode($tuple, JSON_THROW_ON_ERROR));
            $matches[$tuple['sha256']] = $tuple;
        }
        if (count($matches) > 1) {
            $this->decide('review', 'benefits_transfer_evidence_ambiguous');
        }

        return $matches ? array_values($matches)[0] : null;
    }

    private function currentCase(array $proof): array
    {
        $this->assertLease();
        $result = $this->cases->resolve($proof);
        $this->assertLease();
        if (($result['status'] ?? '') !== 'benefits') {
            $status = $result['status'] ?? '';
            $state = match (true) {
                $status === 'not_applicable' => $this->row->transfer_intent ? 'review' : 'not_applicable',
                ($result['reason'] ?? '') === 'native_benefits_case_unverified' => 'waiting',
                $status === 'review' => 'review',
                default => 'waiting',
            };
            $this->decide($state, $result['reason'] ?? 'benefits_case_unavailable');
        }
        if ((string) ($result['case']['category_id'] ?? '') !== '15' || ($result['case']['closed'] ?? '') !== 'N'
            || ! $this->id($result['case']['deal_id'] ?? null) || ! $this->id($result['case']['responsible_id'] ?? null)
            || (string) ($result['chat_id'] ?? '') !== (string) $this->row->chat_id
            || (string) ($result['session_id'] ?? '') !== (string) $this->row->session_id) {
            $this->decide('review', 'benefits_case_unverified');
        }

        return $result;
    }

    private function activeTarget(string $id): void
    {
        $users = $this->read('user.get', ['ID' => $id]);
        $user = is_array($users) && array_is_list($users) && count($users) === 1 ? $users[0] : null;
        if (! is_array($user) || (string) ($user['ID'] ?? '') !== $id || ! in_array($user['ACTIVE'] ?? null, [true, 1, 'Y', '1'], true)
            || (isset($user['USER_TYPE']) && $user['USER_TYPE'] !== 'employee')
            || ! is_array($user['UF_DEPARTMENT'] ?? null) || $user['UF_DEPARTMENT'] === []
            || collect($user['UF_DEPARTMENT'])->contains(fn ($department) => ! $this->id($department))
            || in_array($user['EXTERNAL_AUTH_ID'] ?? '', ['bot', 'imconnector', 'email', 'replica', 'crm'], true)) {
            $this->decide('review', 'benefits_responsible_unavailable');
        }
    }

    private function matchesDialog(array $tuple, mixed $dialog): bool
    {
        if (! is_array($dialog) || ($dialog['entity_type'] ?? '') !== 'LINES' || ! is_string($tuple['source_hash'] ?? null)
            || (string) ($dialog['id'] ?? '') !== (string) ($tuple['chat_id'] ?? '')
            || ! hash_equals($tuple['source_hash'], hash_hmac('sha256', 'organic-source:'.($dialog['entity_id'] ?? ''), (string) config('app.key')))
            || ! in_array($dialog['text_field_enabled'] ?? null, [true, 'Y', 1, '1'], true)) {
            return false;
        }
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        $primary = in_array($parts[2] ?? '', ['', '0'], true) ? '' : ($parts[2] ?? '');
        if ((string) ($parts[5] ?? '') !== (string) ($tuple['session_id'] ?? '')
            || (string) ($parts[6] ?? '') !== (string) ($tuple['session_epoch'] ?? '')
            || (int) ($dialog['owner'] ?? -1) !== (int) ($tuple['owner'] ?? -2)
            || $primary !== ($tuple['primary_id'] ?? null)
            || ($primary === '' ? '' : strtolower($parts[1] ?? '')) !== ($tuple['primary_entity'] ?? null)) {
            return false;
        }
        $rawValue = (string) ($dialog['entity_data_2'] ?? '');
        $raw = $rawValue === '' ? [] : explode('|', $rawValue);
        if (count($raw) % 2 !== 0) {
            return false;
        }
        $bindings = [];
        $seen = [];
        for ($i = 0; $i < count($raw); $i += 2) {
            $entity = strtolower($raw[$i]);
            if (! in_array($entity, ['lead', 'contact', 'deal', 'company'], true) || isset($seen[$entity])) {
                return false;
            }
            $seen[$entity] = true;
            if (! in_array($raw[$i + 1], ['', '0'], true)) {
                $bindings[$entity] = $raw[$i + 1];
            }
        }
        ksort($bindings);

        return $bindings === ($tuple['bindings'] ?? null);
    }

    private function attention(array $result): void
    {
        if (($result['status'] ?? '') === 'ready' && (string) ($result['session_id'] ?? '') === (string) $this->row->session_id
            && isset($result['owner_id']) && is_numeric($result['owner_id'])) {
            return;
        }
        $status = $result['status'] ?? 'waiting';
        $this->decide($status === 'waiting' ? 'waiting' : 'preserved', $result['reason'] ?? 'benefits_attention_unverified');
    }

    private function entry(object $event): ?array
    {
        if (! $this->enabled() || ! Schema::hasTable('edna_intake_cutovers') || ! Schema::hasTable('edna_benefit_chat_routes')) {
            return null;
        }
        $cut = DB::table('edna_intake_cutovers')->where('name', self::NAME)->first();
        if (! $cut || ! $this->id($event->id ?? null) || (int) $event->id <= (int) $cut->entry_id_after
            || (string) ($event->subject_id ?? '') !== (string) config('edna.subject_id')) {
            return null;
        }
        try {
            $payload = json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
            $type = $payload['messageContent']['type'] ?? '';
            $date = $payload['receivedAt'] ?? null;
            if (! is_array($payload) || ($payload['id'] ?? null) !== (string) $event->message_id
                || ($payload['subjectId'] ?? null) !== (string) $event->subject_id
                || ! in_array($type, ['TEXT', 'BUTTON', 'IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO', 'LIST_PICKER'], true)
                || ! is_string($date) || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $date)
                || ! (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''))
                || (new EdnaIntake)->isTestEntry((string) ($payload['messageContent']['text'] ?? ''))) {
                return null;
            }
            $received = CarbonImmutable::parse($date);
            if ($received->lt(CarbonImmutable::parse($cut->starts_at)) || $received->gt(now()->addMinutes(5)) || $received->addHours(8)->lte(now())) {
                return null;
            }

            return $payload;
        } catch (Throwable) {
            return null;
        }
    }

    private function proof(object $event, array $proof): ?array
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || ! in_array($proof['version'] ?? null, [1, 2], true)
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $event->id
            || (string) ($proof['entry_message_id'] ?? '') !== (string) $event->message_id) {
            return null;
        }
        $out = array_intersect_key($proof, array_flip(['version', 'verified', 'source', 'evidence']));
        foreach (['entry_event_id', 'entry_message_id', 'chat_id', 'session_id', 'message_id', 'activity_id'] as $key) {
            if (! $this->id($proof[$key] ?? null)) {
                return null;
            }
            $out[$key] = (string) $proof[$key];
        }
        foreach (['native_lead_id', 'lead_id', 'contact_id'] as $key) {
            if (isset($proof[$key]) && $this->id($proof[$key])) {
                $out[$key] = (string) $proof[$key];
            }
        }

        return $out;
    }

    private function blocking(object $row): array
    {
        if ($row->campaign_reply || $row->case_snapshot) {
            return ['state' => 'preserved', 'reason' => 'benefits_routing'];
        }

        return ['state' => $row->state === 'waiting' || $row->state === 'pending' ? 'waiting' : 'review', 'reason' => $row->reason ?? 'benefits_classification_pending'];
    }

    private function actor(): int
    {
        if (! preg_match('#^/rest/([1-9][0-9]*)/[A-Za-z0-9]+/?$#D', (string) parse_url((string) config('edna.bitrix_url'), PHP_URL_PATH), $matches)) {
            $this->decide('waiting', 'benefits_actor_unavailable');
        }

        return (int) $matches[1];
    }

    private function enabled(): bool
    {
        return config('edna.enabled') && config('edna.intake_crm_enabled');
    }

    private function id(mixed $value): bool
    {
        return (is_string($value) || is_int($value)) && preg_match('/^[1-9][0-9]{0,18}$/D', (string) $value) === 1
            && filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) !== false;
    }

    private function decide(string $state, string $reason): never
    {
        throw new EdnaBenefitsDecision($state, $reason);
    }

    private function assertLease(): void
    {
        if (CarbonImmutable::parse($this->row->expires_at)->lte(now())) {
            $this->decide($this->row->transfer_intent ? 'review' : 'expired', $this->row->transfer_intent ? 'benefits_transfer_unresolved_after_window' : 'benefits_route_window_elapsed');
        }
        if (! $this->enabled() || microtime(true) >= $this->deadline
            || ! DB::table('edna_benefit_chat_routes')->where('entry_event_id', $this->row->entry_event_id)
                ->where('lease_token', $this->row->lease_token)->where('lease_until', '>', now())->exists()) {
            $this->decide('waiting', 'benefits_routing_lease_expired');
        }
    }

    private function read(string $method, array $params): mixed
    {
        $this->assertLease();

        return $this->crm->call($method, $params);
    }

    private function write(array $fields): void
    {
        $this->assertLease();
        if (DB::table('edna_benefit_chat_routes')->where('entry_event_id', $this->row->entry_event_id)->where('lease_token', $this->row->lease_token)
            ->update($fields + ['updated_at' => now()]) !== 1) {
            $this->decide('waiting', 'benefits_routing_lease_superseded');
        }
        foreach ($fields as $key => $value) {
            $this->row->{$key} = $value;
        }
    }

    private function finish(string $state, string $reason, array $fields = []): array
    {
        $next = null;
        if ($state === 'not_applicable' && ! $this->row->transfer_intent) {
            $fields = array_replace($fields, ['case_snapshot' => null, 'deal_id' => null, 'target_id' => null, 'transfer_state' => 'not_needed']);
        }
        if (in_array($state, ['waiting', 'unknown'], true)) {
            if (CarbonImmutable::parse($this->row->expires_at)->lte(now())) {
                $state = $this->row->transfer_intent ? 'review' : 'expired';
                $reason = $this->row->transfer_intent ? 'benefits_transfer_unresolved_after_window' : 'benefits_route_window_elapsed';
            } else {
                $next = CarbonImmutable::now()->addSeconds((new WebFormChatRetryPolicy)->delaySeconds($this->row->attempts))
                    ->min(CarbonImmutable::parse($this->row->expires_at));
            }
        }
        if ($state === 'preserved' && ! isset($fields['transfer_state'])) {
            $fields['transfer_state'] = 'preserved';
        }
        $updated = DB::table('edna_benefit_chat_routes')->where('entry_event_id', $this->row->entry_event_id)->where('lease_token', $this->row->lease_token)
            ->update($fields + ['state' => $state, 'reason' => $reason, 'available_at' => $next, 'lease_token' => null, 'lease_until' => null, 'updated_at' => now()]);
        if ($updated !== 1) {
            return ['state' => 'superseded', 'reason' => 'benefits_routing_lease_superseded'];
        }
        try {
            $row = DB::table('edna_benefit_chat_routes')->where('entry_event_id', $this->row->entry_event_id)->first();
            app(JourneyLedger::class)->record('whatsapp.benefits_route', [
                'entry_event_id' => $row->entry_event_id, 'chat_id' => $row->chat_id, 'native_session_id' => $row->session_id,
                'deal_id' => $row->deal_id, 'target_id' => $row->target_id, 'state' => $state, 'reason' => $reason,
                'transfer_state' => $row->transfer_state, 'transfer_acknowledged' => (bool) $row->transfer_acknowledged,
                'transfer_intent' => $row->transfer_intent ? json_decode($row->transfer_intent, true) : null,
                'native_transfer' => $row->native_transfer ? json_decode($row->native_transfer, true) : null,
            ], [], 'whatsapp.benefits');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) {
            // SQL is the primary durable receipt. Tracking cannot replay a transfer.
        }

        return ['state' => $state, 'reason' => $reason];
    }
}

class EdnaBenefitsDecision extends RuntimeException
{
    public function __construct(public readonly string $state, public readonly string $reason)
    {
        parent::__construct($reason);
    }
}
