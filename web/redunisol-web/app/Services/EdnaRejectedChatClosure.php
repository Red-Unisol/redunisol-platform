<?php

namespace App\Services;

use App\Jobs\CloseEdnaRejectedChat;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** A confirmed rejection plus its exact native notice may close one unattended session. */
class EdnaRejectedChatClosure
{
    private EdnaBitrix $crm;

    private EdnaRejectedChatGuard $guard;

    private EdnaRejectionNotice $notices;

    private ?object $row = null;

    private float $deadline = 0;

    public function __construct(?EdnaBitrix $crm = null, ?EdnaRejectedChatGuard $guard = null, ?EdnaRejectionNotice $notices = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
        $this->guard = $guard ?? new EdnaRejectedChatGuard($this->crm);
        $this->notices = $notices ?? new EdnaRejectionNotice;
    }

    public function poll(int $limit = 25): int
    {
        if (! $this->enabled()) {
            return 0;
        }
        // Discovery is local and bounded. Never enumerate or rewrite the CRM backlog.
        $candidates = app(EdnaRejectedChatCandidates::class)->discover(500);
        $ids = array_values(array_unique(array_column($candidates, 'lead_id')));
        $rejected = [];
        foreach (array_chunk($ids, 50) as $chunk) {
            $start = 0;
            do {
                $response = $this->crm->call('crm.lead.list', ['filter' => ['@ID' => $chunk,
                    'STATUS_ID' => 'UC_1P8I07', 'UF_CRM_REJ_NOTICE' => 'PROCESSED'],
                    'select' => ['ID'], 'start' => $start]);
                // Exactly 50 allowed IDs per request: a full page is complete for this chunk.
                if (! is_array($response) || ! array_is_list($response) || count($response) > 50) {
                    throw new RuntimeException('Rejected lead discovery is incomplete.');
                }
                foreach ($response as $lead) {
                    if (! in_array((string) ($lead['ID'] ?? ''), array_map('strval', $chunk), true)) {
                        throw new RuntimeException('Unexpected rejected lead.');
                    }
                    $rejected[(string) $lead['ID']] = true;
                }
                $start += 50;
            } while (false);
        }
        foreach ($candidates as $candidate) {
            if (! isset($rejected[(string) $candidate['lead_id']])) {
                continue;
            }
            $proof = $candidate['proof'];
            DB::table('edna_rejected_chat_closures')->insertOrIgnore([
                'chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'], 'lead_id' => $candidate['lead_id'],
                'source_type' => $candidate['source_type'], 'source_id' => $candidate['source_id'],
                'source_created_at' => CarbonImmutable::parse($candidate['source_created_at']),
                'proof' => json_encode($proof, JSON_THROW_ON_ERROR), 'state' => 'pending',
                'available_at' => now(), 'expires_at' => now()->addHours(8), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        return DB::transaction(function () use ($limit): int {
            $queue = app(EdnaWorkQueue::class);
            $rows = $queue->withoutPending(DB::table('edna_rejected_chat_closures'), CloseEdnaRejectedChat::class, 'edna_rejected_chat_closures.id')
                ->whereIn('state', ['pending', 'waiting', 'unknown', 'sending'])
                ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->orderBy('id')->limit($limit)->lockForUpdate()->get();
            $count = 0;
            foreach ($rows as $row) {
                $count += (int) $queue->push(new CloseEdnaRejectedChat((int) $row->id));
            }

            return $count;
        });
    }

    public function process(int $id): array
    {
        $this->row = null;
        if (! $this->enabled()) {
            return ['state' => 'disabled'];
        }
        $this->deadline = microtime(true) + 90;
        $this->row = DB::transaction(function () use ($id) {
            $r = DB::table('edna_rejected_chat_closures')->where('id', $id)->lockForUpdate()->first();
            if (! $r || ! in_array($r->state, ['pending', 'waiting', 'unknown', 'sending'], true)
                || ($r->lease_until && CarbonImmutable::parse($r->lease_until)->isFuture())
                || ($r->available_at && CarbonImmutable::parse($r->available_at)->isFuture())) {
                return null;
            }
            if (CarbonImmutable::parse($r->expires_at)->lessThanOrEqualTo(now())) {
                DB::table('edna_rejected_chat_closures')->where('id', $id)->update(['state' => 'review',
                    'reason' => $r->close_intent ? 'close_unresolved_after_window' : 'notice_verification_window_elapsed',
                    'available_at' => null, 'updated_at' => now()]);

                return null;
            }
            $r->lease_token = (string) Str::uuid();
            $r->attempts++;
            DB::table('edna_rejected_chat_closures')->where('id', $id)->update(['lease_token' => $r->lease_token,
                'lease_until' => now()->addSeconds(120), 'attempts' => $r->attempts, 'updated_at' => now()]);

            return $r;
        });
        if (! $this->row) {
            return ['state' => 'not_claimed'];
        }
        $lock = null;
        try {
            $store = Cache::getStore();
            if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
                $this->decide('waiting', 'shared_chat_lock_unavailable');
            }
            // The same chat lock as linking and transfer processes.
            $lock = Cache::lock('web-form-chat:'.$this->row->chat_id, 120, $this->row->lease_token);
            if (! $lock->get()) {
                $this->decide('waiting', 'chat_work_in_progress');
            }
            if ($this->row->close_intent) {
                return $this->reconcile();
            }
            if (in_array($this->row->state, ['sending', 'unknown'], true)) {
                $this->decide('review', 'closure_receipt_incomplete');
            }
            $proof = json_decode($this->row->proof, true, 32, JSON_THROW_ON_ERROR);
            $lead = $this->rejection();
            $this->activity($proof, $lead);
            $notice = $this->notice($proof, $lead);
            $this->write(['notice' => json_encode($notice, JSON_THROW_ON_ERROR)]);
            $first = $this->guard->inspect($proof, $notice);
            $this->attention($first, $lead);
            // Revalidate the decision as well as attention; reopening a lead cancels closure.
            $fresh = $this->rejection();
            foreach (['ID', 'STATUS_ID', 'CONTACT_ID', 'UF_CRM_REJECTION_REASON', 'UF_CRM_REJ_NOTICE', 'MOVED_TIME', 'ASSIGNED_BY_ID'] as $key) {
                if (($lead[$key] ?? null) !== ($fresh[$key] ?? null)) {
                    $this->decide('preserved', 'rejection_changed_during_inspection');
                }
            }
            $this->activity($proof, $fresh);
            $last = $this->guard->inspect($proof, $notice);
            $this->attention($last, $fresh);
            // The human guard can perform several reads. A lead reopened during
            // that interval must be observed before reserving a closing POST.
            $finalLead = $this->rejection();
            foreach (['ID', 'STATUS_ID', 'CONTACT_ID', 'UF_CRM_REJECTION_REASON', 'UF_CRM_REJ_NOTICE', 'MOVED_TIME', 'ASSIGNED_BY_ID'] as $key) {
                if (($fresh[$key] ?? null) !== ($finalLead[$key] ?? null)) {
                    $this->decide('preserved', 'rejection_changed_during_inspection');
                }
            }
            if (! is_string($last['session_created_at'] ?? null)) {
                $this->decide('waiting', 'session_creation_unavailable');
            }
            $intent = ['chat_id' => (int) $this->row->chat_id, 'session_id' => (int) $this->row->session_id,
                'lead_id' => (int) $this->row->lead_id, 'owner_before' => (int) $last['owner_id'],
                'session_created_at' => $last['session_created_at'], 'notice_message_id' => $notice['message_id'],
                'template_sha256' => $notice['template_sha256'], 'created_at' => now()->toIso8601String()];
            $this->write(['close_intent' => json_encode($intent, JSON_THROW_ON_ERROR), 'state' => 'sending']);
            // Bitrix accepts CHAT_ID only. The final read reduces but cannot eliminate
            // a provider-side race; no expected-session/owner CAS exists in this API.
            $this->assertLease();
            try {
                $ack = $this->crm->call('imopenlines.operator.another.finish', ['CHAT_ID' => (int) $this->row->chat_id]);
                if ($ack === true) {
                    // Store the returned acknowledgement locally even if the window elapsed during POST.
                    if (DB::table('edna_rejected_chat_closures')->where('id', $this->row->id)
                        ->where('lease_token', $this->row->lease_token)->where('lease_until', '>', now())
                        ->update(['close_acknowledged' => true, 'updated_at' => now()]) !== 1) {
                        $this->decide('unknown', 'closure_lease_superseded');
                    }
                }
            } catch (Throwable) {
                // An unsuccessful transport can still have applied the close. Never replay it.
            }

            return $this->reconcile();
        } catch (EdnaRejectedChatDecision $e) {
            return $this->finish($e->state, $e->reason);
        } catch (Throwable) {
            $r = DB::table('edna_rejected_chat_closures')->find($this->row->id);

            return $this->finish($r?->close_intent ? 'unknown' : 'waiting', $r?->close_intent ? 'close_result_uncertain' : 'rejection_reads_unavailable');
        } finally {
            try {
                $lock?->release();
            } catch (Throwable) { /* Expiring locks cannot replay external effects. */
            }
        }
    }

    private function rejection(): array
    {
        $lead = $this->call('crm.lead.get', ['id' => (int) $this->row->lead_id]);
        if (! is_array($lead) || (string) ($lead['ID'] ?? '') !== (string) $this->row->lead_id) {
            $this->decide('waiting', 'rejected_lead_unavailable');
        }
        if (($lead['STATUS_ID'] ?? '') !== 'UC_1P8I07') {
            $this->decide('preserved', 'lead_not_rejected');
        }
        if (($lead['UF_CRM_REJ_NOTICE'] ?? '') !== 'PROCESSED') {
            $this->decide('waiting', 'rejection_notice_not_processed');
        }
        if (! is_string($lead['MOVED_TIME'] ?? null) || ! $lead['MOVED_TIME']) {
            $this->decide('review', 'rejection_time_unavailable');
        }
        if (! in_array((string) ($lead['ASSIGNED_BY_ID'] ?? ''), ['0', '57', '74827', '71283'], true)) {
            $this->decide('preserved', 'crm_responsible_preserved');
        }

        return $lead;
    }

    private function activity(array $proof, array $lead): void
    {
        $activityId = $proof['activity_id'] ?? null;
        if (! $this->id($activityId)) {
            $this->decide('review', 'native_activity_unavailable');
        }
        $a = $this->call('crm.activity.get', ['id' => (int) $activityId]);
        if (! is_array($a) || (string) ($a['ID'] ?? '') !== (string) $activityId
            || ($a['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
            || (string) ($a['ASSOCIATED_ENTITY_ID'] ?? '') !== (string) $this->row->session_id) {
            $this->decide('preserved', 'native_activity_changed');
        }
        $owner = [(string) ($a['OWNER_TYPE_ID'] ?? ''), (string) ($a['OWNER_ID'] ?? '')];
        if ($owner !== ['1', (string) $lead['ID']] && (! $this->id($lead['CONTACT_ID'] ?? null) || $owner !== ['3', (string) $lead['CONTACT_ID']])) {
            $this->decide('preserved', 'native_case_changed');
        }
    }

    private function notice(array $proof, array $lead): array
    {
        $fields = $this->call('crm.lead.fields');
        $labels = [];
        foreach ($fields['UF_CRM_REJECTION_REASON']['items'] ?? [] as $item) {
            $labels[(string) ($item['ID'] ?? '')] = $item['VALUE'] ?? null;
        }
        $reason = $labels[(string) ($lead['UF_CRM_REJECTION_REASON'] ?? '')] ?? null;
        if (! is_string($reason) || $reason === '') {
            $this->decide('review', 'rejection_reason_unverified');
        }
        $history = $this->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $this->row->session_id]);
        if (! is_array($history) || ($history['hasNextPage'] ?? null) !== false
            || (string) ($history['chatId'] ?? '') !== (string) $this->row->chat_id
            || (string) ($history['sessionId'] ?? '') !== (string) $this->row->session_id
            || ! is_array($history['message'] ?? null)) {
            $this->decide('waiting', 'notice_history_incomplete');
        }
        $matches = [];
        foreach ($history['message'] as $m) {
            $params = $m['params'] ?? [];
            if (is_string($params)) {
                $params = json_decode($params, true);
            }
            $user = $history['users'][(string) ($m['senderid'] ?? '')] ?? null;
            $mid = is_array($params) ? ($params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? []) : [];
            $mid = is_array($mid) ? $mid : [$mid];
            if (! is_array($params) || ($params['class'] ?? $params['CLASS'] ?? '') !== 'bx-messenger-content-item-ol-output'
                || ! is_array($user) || ($user['connector'] ?? null) !== false || ! $this->id($m['id'] ?? null)
                || ! $this->id($m['senderid'] ?? null) || ! is_string($m['text'] ?? null)
                || ! is_string($m['date'] ?? null) || ! $mid) {
                continue;
            }
            $connectorMid = count($mid) === 1 ? reset($mid) : null;
            if (! is_string($connectorMid) || $connectorMid === '' || strlen($connectorMid) > 191) {
                continue;
            }
            $date = CarbonImmutable::parse($m['date']);
            if ($date->lessThan(CarbonImmutable::parse($lead['MOVED_TIME'])) || $date->lessThan(CarbonImmutable::parse($this->row->source_created_at))) {
                continue;
            }
            if ($match = $this->notices->match($m['text'], $reason)) {
                $matches[] = $match + ['message_id' => (string) $m['id'], 'date' => $m['date'],
                    'native_text_sha256' => hash('sha256', $m['text']), 'sender_id' => (string) $m['senderid'], 'connector_mid' => $connectorMid];
            }
        }
        if (count($matches) > 1) {
            $this->decide('review', 'multiple_rejection_notices');
        }
        if (! $matches) {
            $this->decide('waiting', 'verified_rejection_notice_pending');
        }

        return $matches[0];
    }

    private function attention(array $result, array $lead): void
    {
        $status = $result['status'] ?? 'waiting';
        if ($status === 'closed') {
            $this->decide('observed', 'session_already_closed');
        }
        if ($status !== 'ready') {
            $this->decide(in_array($status, ['preserved', 'replaced'], true) ? 'preserved' : 'waiting', $result['reason'] ?? 'attention_unverified');
        }
        $parts = explode('|', (string) ($result['dialog']['entity_data_1'] ?? ''));
        $native = [$parts[1] ?? '', $parts[2] ?? ''];
        if ($native !== ['LEAD', (string) $lead['ID']] && (! $this->id($lead['CONTACT_ID'] ?? null) || $native !== ['CONTACT', (string) $lead['CONTACT_ID']])) {
            $this->decide('preserved', 'dialog_case_changed');
        }
    }

    private function reconcile(): array
    {
        $r = DB::table('edna_rejected_chat_closures')->find($this->row->id);
        $intent = json_decode($r->close_intent ?? '{}', true, 16, JSON_THROW_ON_ERROR);
        if (! is_string($intent['session_created_at'] ?? null)) {
            return $this->finish('review', 'closure_receipt_incomplete');
        }
        $created = CarbonImmutable::parse($intent['session_created_at']);
        $data = $this->call('imopenlines.v2.Session.list', ['configId' => 1, 'dateCreateFrom' => $created->subSeconds(2)->toIso8601String(),
            'dateCreateTo' => $created->addSeconds(2)->toIso8601String(), 'limit' => 200]);
        if (! is_array($data) || ($data['hasNextPage'] ?? null) !== false || ! is_array($data['sessions'] ?? null)) {
            return $this->finish('unknown', 'close_session_lookup_incomplete');
        }
        $matches = array_values(array_filter($data['sessions'], fn ($s) => (string) ($s['id'] ?? '') === (string) $this->row->session_id
            && (string) ($s['chatId'] ?? '') === (string) $this->row->chat_id && (string) ($s['configId'] ?? '') === '1'));
        if (count($matches) !== 1) {
            return $this->finish('unknown', 'close_session_unavailable');
        }
        if (! empty($matches[0]['dateClose']) && ($matches[0]['status'] ?? '') === 'closed') {
            return $this->finish($r->close_acknowledged ? 'closed' : 'observed', $r->close_acknowledged ? 'rejected_session_closed' : 'closed_without_acknowledgement');
        }

        return $this->finish('unknown', 'close_not_yet_observed');
    }

    private function enabled(): bool
    {
        return config('edna.enabled') && config('edna.intake_crm_enabled') && config('edna.rejection_close_enabled');
    }

    private function id(mixed $v): bool
    {
        return (is_string($v) || is_int($v)) && preg_match('/^[1-9][0-9]{0,17}$/D', (string) $v) === 1;
    }

    private function decide(string $state, string $reason): never
    {
        throw new EdnaRejectedChatDecision($state, $reason);
    }

    private function assertLease(): void
    {
        if (! $this->enabled() || microtime(true) >= $this->deadline || CarbonImmutable::parse($this->row->expires_at)->lessThanOrEqualTo(now())
            || ! DB::table('edna_rejected_chat_closures')->where('id', $this->row->id)->where('lease_token', $this->row->lease_token)->where('lease_until', '>', now())->exists()) {
            $this->decide('waiting', 'closure_lease_or_window_expired');
        }
    }

    private function call(string $method, array $params = []): mixed
    {
        $this->assertLease();

        return $this->crm->call($method, $params);
    }

    private function write(array $fields): void
    {
        $this->assertLease();
        if (DB::table('edna_rejected_chat_closures')->where('id', $this->row->id)->where('lease_token', $this->row->lease_token)->update($fields + ['updated_at' => now()]) !== 1) {
            $this->decide('waiting', 'closure_lease_superseded');
        }
    }

    private function finish(string $state, string $reason): array
    {
        $next = null;
        if (in_array($state, ['waiting', 'unknown'], true)) {
            if (CarbonImmutable::parse($this->row->expires_at)->lessThanOrEqualTo(now())) {
                $state = 'review';
                $reason = 'closure_verification_window_elapsed';
            } else {
                $next = CarbonImmutable::now()->addSeconds((new WebFormChatRetryPolicy)->delaySeconds($this->row->attempts))->min(CarbonImmutable::parse($this->row->expires_at));
            }
        }
        $updated = DB::table('edna_rejected_chat_closures')->where('id', $this->row->id)->where('lease_token', $this->row->lease_token)->update([
            'state' => $state, 'reason' => $reason, 'available_at' => $next, 'lease_token' => null, 'lease_until' => null, 'updated_at' => now(),
        ]);
        if ($updated !== 1) {
            return ['state' => 'superseded', 'reason' => 'closure_lease_superseded'];
        }
        try {
            $r = DB::table('edna_rejected_chat_closures')->find($this->row->id);
            app(JourneyLedger::class)->record('whatsapp.rejection_close', ['closure_id' => $r->id, 'chat_id' => $r->chat_id,
                'native_session_id' => $r->session_id, 'lead_id' => $r->lead_id, 'state' => $state, 'reason' => $reason,
                'close_intent' => $r->close_intent ? json_decode($r->close_intent, true) : null, 'close_acknowledged' => (bool) $r->close_acknowledged], [], 'whatsapp.rejection');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) { /* Durable SQL receipt is primary; journal failures never replay a close. */
        }

        return ['state' => $state, 'reason' => $reason];
    }
}

class EdnaRejectedChatDecision extends RuntimeException
{
    public function __construct(public readonly string $state, public readonly string $reason)
    {
        parent::__construct($reason);
    }
}
