<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/** A server-side consumer of native Open Line 1 sessions. Never sends customer messages. */
class SalesInbox
{
    public function __construct(private EdnaBitrix $crm, private WebFormChatGuard $attention, private SalesInboxPolicy $policy) {}

    public function poll(): void
    {
        if (! config('edna.sales_inbox_enabled') || ! config('edna.intake_crm_enabled')) {
            return;
        }
        if (! app()->runningUnitTests() && ! (Cache::getStore() instanceof DatabaseStore || Cache::getStore() instanceof RedisStore)) {
            throw new RuntimeException('Shared chat lock required.');
        }
        // A failed discovery page must not strand previously captured work.
        try {
            $this->discover();
        } catch (Throwable) {
            report(new RuntimeException('Sales inbox discovery failed; checkpoint retained.'));
        }
        $started = microtime(true);
        // A seller allocation is only a wake-up hint; the worker checks the exact deal and its current seller again.
        $dealId = DB::connection()->getQueryGrammar()->wrap('sales_inbox_sessions.campaign->deal_id');
        DB::table('sales_inbox_sessions')->where('state', 'waiting')->where('reason', 'commercial_seller_pending')
            ->whereNotNull('campaign')->whereNull('intent')->where('available_at', '>', now())
            ->whereExists(function (Builder $q) use ($dealId): void {
                $q->selectRaw('1')->from('bitrix_routing_allocations as a')->where('a.scope', config('chat_response.scope'))
                    ->whereRaw("a.deal_id = CAST({$dealId} AS BIGINT)")->whereColumn('a.created_at', '>=', 'sales_inbox_sessions.updated_at')
                    ->where('a.created_at', '<=', now()->subSeconds(15));
            })->update(['available_at' => now(), 'updated_at' => now()]);
        $due = DB::table('sales_inbox_sessions')->whereIn('state', ['pending', 'waiting', 'waiting_customer', 'uncertain'])
            ->where('available_at', '<=', now())->orderBy('available_at')->orderBy('session_id');
        $fresh = (clone $due)->where('attempts', 0)->limit(20)->get();
        $retries = (clone $due)->where('attempts', '>', 0)->limit(20)->get();
        $rows = [];
        for ($i = 0; $i < max($fresh->count(), $retries->count()); $i++) {
            if (isset($fresh[$i])) {
                $rows[] = $fresh[$i];
            }
            if (isset($retries[$i])) {
                $rows[] = $retries[$i];
            }
        }
        foreach ($rows as $row) {
            $this->process($row);
            if (microtime(true) - $started >= 40) {
                break;
            }
        }
    }

    private function discover(): void
    {
        $now = CarbonImmutable::now()->utc()->startOfSecond();
        $cursor = DB::table('sales_inbox_cursors')->where('line_id', 1);
        $cursor->insertOrIgnore(['line_id' => 1, 'starts_at' => $now, 'scanned_until' => $now]);
        $checkpoint = $cursor->first();
        $start = CarbonImmutable::parse($checkpoint->starts_at, 'UTC');
        $previous = CarbonImmutable::parse($checkpoint->scanned_until, 'UTC');
        $end = $previous->addMinutes(20)->min($now->subSeconds(10));
        if ($end->lte($previous)) {
            return;
        }
        // Replay a small overlap for delayed indexing. Session IDs make page boundaries and crashes harmless.
        $from = $previous->subMinutes(5)->max($start);
        $offset = 0;
        $seen = [];
        do {
            $data = $this->crm->call('imopenlines.v2.Session.list', ['configId' => 1, 'dateCreateFrom' => $from->toIso8601String(),
                'dateCreateTo' => $end->toIso8601String(), 'order' => 'dateCreate', 'orderDirection' => 'asc', 'limit' => 200, 'offset' => $offset]);
            if (! is_array($data['sessions'] ?? null) || ! array_is_list($data['sessions']) || ! is_bool($data['hasNextPage'] ?? null)
                || ($data['hasNextPage'] && ! $data['sessions'])) {
                throw new RuntimeException('Incomplete native session page.');
            }
            $before = count($seen);
            $rows = [];
            foreach ($data['sessions'] as $s) {
                if ((int) ($s['configId'] ?? 0) !== 1 || ! $this->positive($s['id'] ?? null) || ! $this->positive($s['chatId'] ?? null)
                    || ! is_string($s['source'] ?? null) || ! is_string($s['dateCreate'] ?? null) || ! preg_match('/(?:Z|[+-]\d\d:\d\d)$/D', $s['dateCreate'])) {
                    throw new RuntimeException('Invalid native session identity.');
                }
                $seen[(int) $s['id']] = true;
                $at = CarbonImmutable::parse($s['dateCreate'])->utc();
                if ($at->lt($start) || $at->gt($end)) {
                    continue;
                }
                $known = in_array($s['source'], SalesInboxPolicy::CHANNELS, true);
                $rows[] = ['chat_id' => $s['chatId'], 'session_id' => $s['id'], 'channel' => $known ? $s['source'] : 'unknown',
                    'opened_at' => $at, 'state' => $known ? 'pending' : 'needs_attention', 'reason' => $known ? null : 'unsupported_source',
                    'available_at' => $known ? $at->addMinutes(2) : null, 'created_at' => $now, 'updated_at' => $now];
            }
            if ($data['hasNextPage'] && count($seen) === $before) {
                throw new RuntimeException('Native session pagination stopped advancing.');
            }
            if ($rows) {
                DB::table('sales_inbox_sessions')->insertOrIgnore($rows);
            }
            $offset += count($data['sessions']);
        } while ($data['hasNextPage']);
        $cursor->where('scanned_until', $checkpoint->scanned_until)->update(['scanned_until' => $end]);
    }

    private function process(object $candidate): void
    {
        $lock = Cache::lock('web-form-chat:'.$candidate->chat_id, 150);
        if (! $lock->get()) {
            $this->row($candidate)->where('available_at', '<=', now())->update(['available_at' => now()->addSeconds(20)]);

            return;
        }
        try {
            $r = $this->row($candidate)->first();
            if (! $r || ! in_array($r->state, ['pending', 'waiting', 'waiting_customer', 'uncertain'], true)
                || CarbonImmutable::parse($r->available_at)->isFuture()) {
                return;
            }
            $this->row($r)->increment('attempts');
            if ($r->intent) {
                $this->reconcile($r);

                return;
            }
            if ($this->retryDeadline($r)->isPast()) {
                $this->finish($r, 'needs_attention', 'session_effect_window_elapsed');

                return;
            }
            $dialog = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $r->chat_id]);
            $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
            if ((int) ($dialog['id'] ?? 0) !== (int) $r->chat_id || ($dialog['entity_type'] ?? '') !== 'LINES'
                || count($parts) < 7 || ! ctype_digit($parts[5]) || ! array_key_exists('text_field_enabled', $dialog)) {
                throw new RuntimeException('Inbox dialog identity unavailable.');
            }
            if (! in_array($dialog['text_field_enabled'], [true, 'Y', 1, '1'], true) || $parts[5] !== (string) $r->session_id) {
                $this->finish($r, 'preserved', 'previous_session_closed_or_replaced');

                return;
            }
            if ($this->positive($dialog['owner'] ?? null) && ! in_array((int) $dialog['owner'], [57, 74827], true)) {
                $this->finish($r, 'preserved', 'session_with_assigned_operator');

                return;
            }
            $decision = $this->decide($r, $dialog);
            if (! isset($decision['action'])) {
                if (isset($decision['next_at'])) {
                    $this->row($r)->update(['state' => $decision['state'], 'reason' => $decision['reason'],
                        'available_at' => $decision['next_at'], 'updated_at' => now()]);
                } else {
                    $this->finish($r, $decision['state'], $decision['reason']);
                }

                return;
            }
            $check = $this->attention->inspectListed((int) $r->chat_id, (int) $r->session_id, $r->channel, $decision['target_id'] ?: 5737);
            if (($check['status'] ?? '') !== 'ready' || ! in_array($check['owner_id'] ?? null, [0, 57, 74827], true)) {
                $this->finish($r, match ($check['status'] ?? '') {
                    'closed', 'replaced', 'preserved', 'already_assigned' => 'preserved', default => 'waiting',
                }, $check['reason'] ?? 'attention_unknown');

                return;
            }
            if ($decision['action'] === 'transfer' && ! (new EdnaOrganicAttention($this->crm))->targetActive($decision['target_id'])) {
                $this->finish($r, 'waiting', 'target_operator_unavailable');

                return;
            }
            if (! $lock->isOwnedByCurrentProcess()) {
                $this->finish($r, 'waiting', 'session_changed');

                return;
            }
            // Reread the seller and inbound after Edna's window lookup and before the last native human-attention checks.
            $sameDecision = fn () => $this->decide($r, $dialog) === $decision;
            $window = $decision['action'] === 'transfer' ? SalesTransferWindow::forLocalTransfer($this->crm, (int) $r->chat_id, (int) $r->session_id, $check['dialog'] ?? null, requireWindow: true) : null;
            $last = $this->attention->inspectListed((int) $r->chat_id, (int) $r->session_id, $r->channel, $decision['target_id'] ?: 5737, $sameDecision);
            if (($last['status'] ?? '') !== 'ready' || $last['owner_id'] !== $check['owner_id'] || $last['dialog'] !== $check['dialog']
                || ! $lock->isOwnedByCurrentProcess()) {
                $this->finish($r, 'waiting', 'session_changed_before_effect');

                return;
            }
            if ($window !== null && ($reason = SalesTransferWindow::localBlockReason($window))) {
                $this->finish($r, SalesTransferWindow::blockedState($reason), $reason);

                return;
            }
            $intent = $decision + ['chat_id' => (int) $r->chat_id, 'session_id' => (int) $r->session_id, 'owner_before' => $last['owner_id'],
                'created_at' => now()->utc()->toIso8601String()];
            if (! $lock->isOwnedByCurrentProcess() || $this->row($r)->whereNull('intent')->update(['intent' => json_encode($intent, JSON_THROW_ON_ERROR),
                'state' => 'uncertain', 'reason' => 'effect_pending_confirmation', 'available_at' => now()->addSeconds(30), 'updated_at' => now()]) !== 1) {
                return;
            }
            if (! $lock->isOwnedByCurrentProcess()) {
                return;
            }
            if ($window !== null && ($reason = SalesTransferWindow::localBlockReason($window))) {
                $this->row($r)->update(['state' => 'waiting', 'reason' => $reason, 'intent' => null, 'available_at' => now()->addSeconds(10), 'updated_at' => now()]);

                return;
            }
            $ack = $decision['action'] === 'close'
                ? $this->crm->call('imopenlines.operator.another.finish', ['CHAT_ID' => (int) $r->chat_id])
                : $this->crm->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $r->chat_id, 'USER_ID' => $decision['target_id']]);
            if ($ack === true) {
                $this->row($r)->update(['acknowledged' => true, 'updated_at' => now()]);
            }
            $this->reconcile($this->row($r)->first());
        } catch (Throwable) {
            $r = $this->row($candidate)->first();
            if (! $lock->isOwnedByCurrentProcess()) {
                return;
            }
            $this->finish($r, $r->intent ? 'uncertain' : 'waiting', $r->intent ? 'effect_pending_confirmation' : 'native_evidence_unavailable');
        } finally {
            $lock->release();
        }
    }

    private function decide(object $r, array $dialog): array
    {
        $history = $this->crm->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $r->session_id]);
        $message = $this->policy->conversation($history, $r);
        switch ($message['reason']) {
            case 'inbound_not_visible': return ['state' => 'waiting'] + $message;
            case 'operator_message_preserved': return ['state' => 'preserved'] + $message;
            case 'explicit_terminal_reply': return ['action' => 'close', 'target_id' => 0] + $message;
        }
        if ($r->channel === 'whatsappbyedna') {
            if ($r->campaign) {
                return app(SalesCampaignReply::class)->decision($r, $message, $history);
            }
            if ($native = app(SalesCampaignReply::class)->directNative($r, $history, $message)) {
                return $native;
            }
            $due = app(EdnaCustomerWait::class)->dueAt((int) $r->session_id, (int) $r->chat_id, $message['last_customer_at'], $message['message_id']);
            if ($due && $due->isFuture()) {
                return ['state' => 'waiting_customer', 'reason' => 'verified_customer_wait', 'next_at' => $due->utc()];
            }
            if ($due) {
                return ['action' => 'close', 'target_id' => 0, 'reason' => 'verified_customer_wait_expired',
                    'last_customer_at' => $message['last_customer_at'], 'message_id' => $message['message_id']];
            }

            $benefits = DB::table('edna_benefit_chat_routes')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)
                ->orderByDesc('entry_event_id')->first();
            if ($benefits) {
                if ($benefits->state === 'routed') {
                    return ['state' => 'channel_workflow', 'reason' => 'benefits_routing_receipt'];
                }

                return in_array($benefits->state, ['pending', 'waiting', 'sending', 'unknown'], true)
                    ? ['state' => 'waiting', 'reason' => 'benefits_workflow_pending']
                    : ['state' => 'needs_attention', 'reason' => 'benefits_route_incomplete'];
            }
            $context = DB::table('web_chat_contexts')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)->orderByDesc('id')->first();
            if ($context) {
                if ($context->transfer_state === 'confirmed' && $context->transfer_acknowledged && $context->confirmed_transfer_entry_event_id) {
                    return ['state' => 'channel_workflow', 'reason' => 'web_transfer_receipt'];
                }
                if (! in_array($context->state, ['waiting', 'bound'], true) || CarbonImmutable::parse($context->expires_at)->isPast()) {
                    return ['state' => 'needs_attention', 'reason' => 'web_context_ended_without_delivery'];
                }

                return ['state' => 'waiting', 'reason' => 'web_workflow_pending'];
            }

            $flows = app(SalesSessionFlow::class);
            if ($flow = $flows->find((int) $r->chat_id, (int) $r->session_id)) {
                return $flows->disposition($flow);
            }

            return $this->unresolvedOutcome($r, $dialog, $history, $message['message_id']);
        }
        $dialog = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $r->chat_id]);
        $tuple = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        $bindings = rtrim((string) ($dialog['entity_data_2'] ?? ''), '|');
        $bindings = $bindings === '' ? [] : explode('|', $bindings);
        if (count($tuple) < 7 || (string) $r->session_id !== $tuple[5] || count($bindings) % 2 !== 0
            || ! array_key_exists('entity_data_2', $dialog) || (int) ($dialog['id'] ?? 0) !== (int) $r->chat_id) {
            return ['state' => 'waiting', 'reason' => 'social_bindings_unavailable'];
        }
        $entities = [];
        for ($i = 0; $i < count($bindings); $i += 2) {
            if ($this->positive($bindings[$i + 1])) {
                if (isset($entities[$bindings[$i]]) && $entities[$bindings[$i]] !== $bindings[$i + 1]) {
                    return ['state' => 'waiting', 'reason' => 'social_bindings_ambiguous'];
                }
                $entities[$bindings[$i]] = $bindings[$i + 1];
            }
        }
        if ($this->positive($tuple[2])) {
            if (isset($entities[$tuple[1]]) && $entities[$tuple[1]] !== $tuple[2]) {
                return ['state' => 'waiting', 'reason' => 'social_bindings_changed'];
            }
            $entities[$tuple[1]] = $tuple[2];
        }
        $filter = isset($entities['DEAL']) ? ['=ID' => $entities['DEAL']]
            : (isset($entities['LEAD']) ? ['=LEAD_ID' => $entities['LEAD']]
                : (isset($entities['CONTACT']) ? ['=CONTACT_ID' => $entities['CONTACT']] : null));
        if ($filter) {
            $deals = $this->crm->call('crm.deal.list', ['filter' => $filter + ['=STAGE_SEMANTIC_ID' => 'P'],
                'select' => ['ID', 'LEAD_ID', 'CONTACT_ID', 'ASSIGNED_BY_ID', 'CATEGORY_ID', 'STAGE_SEMANTIC_ID']]);
            if (! is_array($deals) || ! array_is_list($deals) || count($deals) > 1) {
                return ['state' => 'waiting', 'reason' => 'social_deal_ambiguous'];
            }
            if ($deals) {
                $d = $deals[0];
                $target = (int) ($d['ASSIGNED_BY_ID'] ?? 0);
                if (! $this->positive($d['ID'] ?? null) || ($d['STAGE_SEMANTIC_ID'] ?? '') !== 'P'
                    || (isset($entities['DEAL']) && (string) $d['ID'] !== $entities['DEAL'])
                    || (isset($entities['LEAD']) && (string) ($d['LEAD_ID'] ?? '') !== $entities['LEAD'])
                    || (isset($entities['CONTACT']) && (string) ($d['CONTACT_ID'] ?? '') !== $entities['CONTACT'])
                    || ! in_array((string) ($d['CATEGORY_ID'] ?? ''), ['1', '5'], true)
                    || ! $target || in_array($target, [57, 74827, 71283], true)) {
                    return ['state' => 'waiting', 'reason' => 'social_deal_owner_pending'];
                }

                return ['action' => 'transfer', 'reason' => 'social_linked_deal_owner', 'deal_id' => (int) $d['ID'],
                    'target_id' => $target, 'message_id' => $message['message_id']];
            }
        }
        if (isset($entities['LEAD'])) {
            $lead = $this->crm->call('crm.lead.get', ['id' => (int) $entities['LEAD']]);
            if ((string) ($lead['ID'] ?? '') !== $entities['LEAD'] || ! array_key_exists('ASSIGNED_BY_ID', $lead)) {
                return ['state' => 'waiting', 'reason' => 'social_lead_unavailable'];
            }
            $owner = (int) $lead['ASSIGNED_BY_ID'];
            if (($lead['STATUS_SEMANTIC_ID'] ?? '') === 'P' && $owner > 0 && ! in_array($owner, [57, 74827, 71283], true)) {
                return ['action' => 'transfer', 'reason' => 'social_native_lead_owner', 'target_id' => $owner,
                    'lead_id' => (int) $lead['ID'], 'message_id' => $message['message_id']];
            }
        }
        $target = (int) config('edna.sales_social_operator_id');
        if ($target <= 0 || in_array($target, [57, 74827, 71283], true)) {
            return ['state' => 'waiting', 'reason' => 'social_desk_not_configured'];
        }

        return ['action' => 'transfer', 'reason' => 'social_intake_desk', 'target_id' => $target, 'message_id' => $message['message_id']];
    }

    /** Compare the native connector ID with the event ledger; neither the phone nor the message text is exported. */
    private function unresolvedOutcome(object $r, array $dialog, array $history, int $latest): array
    {
        $expired = CarbonImmutable::parse($r->opened_at, 'UTC')->addHours(8)->lte(now());
        $fallback = fn (string $reason) => $expired ? ['state' => 'needs_attention', 'reason' => $reason]
            : ['state' => 'waiting', 'reason' => 'no_verified_channel_outcome'];
        $subject = (string) config('edna.subject_id');
        $tuple = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        if (! $this->positive($subject) || (int) ($dialog['id'] ?? 0) !== (int) $r->chat_id
            || ($dialog['entity_type'] ?? '') !== 'LINES' || (string) ($tuple[5] ?? '') !== (string) $r->session_id
            || ! preg_match('/^whatsappbyedna\|1\|[0-9]{10,15}@'.preg_quote($subject, '/').'\|[0-9]+$/D', (string) ($dialog['entity_id'] ?? ''))) {
            return $fallback('callback_identity_unverified');
        }
        foreach ($history['message'] as $m) {
            if ((int) $m['id'] !== $latest || ($history['users'][(int) $m['senderid']]['connector'] ?? null) !== true) {
                continue;
            }
            $params = $m['params'] ?? [];
            $params = is_string($params) ? json_decode($params, true) : $params;
            $ids = $params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? null;
            if (! is_array($ids) || count($ids) !== 1 || ! $this->positive($ids[0] ?? null)) {
                break;
            }
            $received = DB::table('edna_incoming_events')->where('subject_id', $subject)->where('message_id', (string) $ids[0])->value('id');
            if ($received) {
                $notice = DB::table('edna_out_of_hours_sends')->where('event_id', $received)->where('subject_id', $subject)
                    ->where('cascade_id', (string) config('edna.cascade_id'))->where('state', 'confirmed')->whereNotNull('outgoing_message_id')->first();
                if ($notice && CarbonImmutable::parse($notice->window_end, 'UTC')->isFuture()) {
                    return ['state' => 'waiting', 'reason' => 'outside_hours_notice_confirmed', 'next_at' => CarbonImmutable::parse($notice->window_end, 'UTC')];
                }

                return $fallback($notice ? 'no_chat_outcome_after_opening' : 'callback_received_without_verified_outcome');
            }

            return $fallback('native_message_missing_callback');
        }

        return $fallback('callback_identity_unverified');
    }

    private function reconcile(object $r): void
    {
        $intent = json_decode($r->intent, true, flags: JSON_THROW_ON_ERROR);
        if ($intent['action'] === 'close') {
            $at = CarbonImmutable::parse($r->opened_at, 'UTC');
            $data = $this->crm->call('imopenlines.v2.Session.list', ['configId' => 1, 'dateCreateFrom' => $at->subSeconds(2)->toIso8601String(),
                'dateCreateTo' => $at->addSeconds(2)->toIso8601String(), 'limit' => 200]);
            if (($data['hasNextPage'] ?? null) === false) {
                foreach ($data['sessions'] ?? [] as $s) {
                    if ((int) ($s['id'] ?? 0) === (int) $r->session_id && (int) ($s['configId'] ?? 0) === 1
                        && (int) ($s['chatId'] ?? 0) === (int) $r->chat_id && ($s['status'] ?? '') === 'closed' && ! empty($s['dateClose'])
                        && CarbonImmutable::parse($s['dateClose'])->gte(CarbonImmutable::parse($intent['created_at']))) {
                        $this->finish($r, $r->acknowledged ? 'closed' : 'observed', 'session_closed');

                        return;
                    }
                }
            }
        } else {
            $fingerprint = SalesNativeTransfer::fingerprint($this->crm, (int) $r->chat_id, (int) $r->session_id,
                $intent['target_id'], CarbonImmutable::parse($intent['created_at']), $intent['owner_before'] ?? null);
            if ($fingerprint !== null) {
                $this->row($r)->update(['native_event_sha256' => $fingerprint]);
                $this->finish($r, $r->acknowledged ? 'transferred' : 'observed', 'native_transfer_found');

                return;
            }
        }
        $this->finish($r, 'uncertain', 'effect_pending_confirmation');
    }

    private function row(object $r): Builder
    {
        return DB::table('sales_inbox_sessions')->where('session_id', $r->session_id);
    }

    private function finish(object $r, string $state, string $reason): void
    {
        $retry = in_array($state, ['waiting', 'uncertain'], true);
        $deadline = $this->retryDeadline($r);
        if ($reason === 'no_verified_channel_outcome') {
            $deadline = CarbonImmutable::parse($r->opened_at, 'UTC')->addHours(8);
        }
        if ($retry && $deadline->isPast()) {
            $state = 'needs_attention';
            $retry = false;
        }
        $maxDelay = $reason === 'commercial_deal_pending' ? 300 : 1800;
        $next = $retry ? now()->addSeconds((new WebFormChatRetryPolicy)->delaySeconds((int) $r->attempts + 1, $maxDelay)) : null;
        $this->row($r)->update(['state' => $state, 'reason' => $reason, 'available_at' => $next, 'updated_at' => now()]);
    }

    private function retryDeadline(object $row): CarbonImmutable
    {
        $start = CarbonImmutable::parse($row->opened_at, 'UTC');
        $campaign = json_decode($row->campaign ?? 'null', true, flags: JSON_THROW_ON_ERROR);
        if (isset($campaign['received_at'])) {
            $start = $start->max(CarbonImmutable::parse($campaign['received_at']));
        }

        return $start->addDays(3);
    }

    private function positive(mixed $id): bool
    {
        return (is_int($id) || is_string($id)) && preg_match('/^[1-9][0-9]{0,17}$/D', (string) $id) === 1;
    }
}
