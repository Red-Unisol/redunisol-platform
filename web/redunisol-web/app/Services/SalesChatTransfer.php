<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Cache\Lock;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/** Durable custody of Kestra's exact commercial handoff. After intent_at is committed only native reads may be retried. */
final class SalesChatTransfer
{
    public const TABLE = 'sales_chat_transfer_requests';

    public function __construct(
        private EdnaBitrix $crm,
        private WebFormChatGuard $attention,
        private SalesTransferWindow $window,
    ) {}

    public static function ownsSession(int $chatId, int $sessionId): bool
    {
        return self::scoped()->where('chat_id', $chatId)->where('session_id', $sessionId)->exists();
    }

    private static function scoped(): Builder
    {
        return DB::table(self::TABLE)->where('scope', config('chat_response.scope'));
    }

    public static function counts(?array $sessions = null): array
    {
        $rows = self::scoped();
        if ($sessions !== null) {
            $rows->whereIntegerInRaw('session_id', $sessions);
        }

        return $rows->selectRaw('state, reason, count(*) as total, sum(case when unverified_checks > 0 then 1 else 0 end) as previously_unverified, sum(unverified_checks) as unverified_checks')->groupBy('state', 'reason')
            ->orderBy('state')->orderBy('reason')->get()->map(fn ($row) => [
                'state' => $row->state, 'reason' => $row->reason, 'requests' => (int) $row->total,
                'requests_ever_unverified' => (int) $row->previously_unverified, 'unverified_checks' => (int) $row->unverified_checks,
            ])->all();
    }

    public function poll(): void
    {
        if (! config('edna.kestra_chat_transfer_delivery_enabled')) {
            return;
        }
        $start = microtime(true);
        $due = self::scoped()->where('available_at', '<=', now())->orderBy('available_at')->orderBy('id')
            ->limit(40)->get(['id', 'chat_id']);
        foreach ($due as $candidate) {
            $lock = Cache::lock('web-form-chat:'.$candidate->chat_id, 160);
            if ($lock->get()) {
                try {
                    $query = self::scoped()->where('id', $candidate->id);
                    $r = (clone $query)->where('available_at', '<=', now())->first();
                    if ($r) {
                        $query->increment('attempts');
                        $r->attempts++;
                        try {
                            if ($r->intent_at) {
                                $this->reconcile($r);
                            } elseif (CarbonImmutable::parse($r->deadline_at)->lte(now())) {
                                $this->finish($r, 'needs_attention', $r->reason === 'received' ? 'retry_deadline_elapsed' : $r->reason);
                            } else {
                                $this->deliver($r, $lock);
                            }
                        } catch (Throwable) {
                            // A failed read can be retried. After committing the intent we cannot establish whether a POST was delivered.
                            $latest = $query->first();
                            if ($lock->isOwnedByCurrentProcess() && $latest && $latest->available_at) {
                                $this->finish($latest, $latest->intent_at ? 'reconciling' : 'waiting',
                                    $latest->intent_at ? 'post_outcome_unverified' : 'provider_read_unavailable');
                            }
                        }
                    }
                } finally {
                    $lock->release();
                }
            }
            if (microtime(true) - $start > 40) {
                break;
            }
        }
    }

    private function deliver(object $r, Lock $lock): void
    {
        $chat = (int) $r->chat_id;
        $session = (int) $r->session_id;
        $target = (int) $r->target_id;
        if ($this->priorLocalIntent($chat, $session)) {
            $this->finish($r, 'preserved', 'prior_local_effect_intent');

            return;
        }
        $before = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => $chat]);
        $window = $this->window->inspect($this->crm, $chat, $session, $before);
        if ($reason = SalesTransferWindow::blockReason($window)) {
            $this->finish($r, SalesTransferWindow::blockedState($reason), $reason);

            return;
        }

        if (! (new EdnaOrganicAttention($this->crm))->targetActive($target)) {
            $this->finish($r, 'waiting', 'target_operator_unavailable');

            return;
        }
        // During an Edna outage a person can accept the same default owner, reply, or move the deal.
        // Run these live reads inside the native guard, before its final attention, transfer history and owner checks.
        $reason = null;
        $fresh = $this->attention->inspectSalesDelivery($chat, $session, $target,
            function () use ($r, &$reason): bool {
                $history = $this->crm->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $r->session_id]);
                $conversation = (new SalesInboxPolicy)->conversation($history, $r);
                $reason = match ($conversation['reason']) {
                    'operator_message_preserved', 'inbound_not_visible' => $conversation['reason'],
                    default => $this->assignmentBlock($r),
                };

                return $reason === null;
            });
        if ($fresh['status'] !== 'ready' || ! in_array($fresh['owner_id'], [0, 57, 74827], true)) {
            $state = match (true) {
                in_array($fresh['status'], ['already_assigned', 'preserved', 'replaced', 'closed'], true),
                $reason === 'operator_message_preserved',
                $fresh['status'] === 'ready' => 'preserved',
                default => 'waiting',
            };
            $this->finish($r, $state, $reason ?? ($fresh['status'] === 'ready' ? 'chat_owner_preserved' : $fresh['reason']));

            return;
        }
        if (($before['entity_id'] ?? null) !== ($fresh['dialog']['entity_id'] ?? null)) {
            $this->finish($r, 'waiting', 'native_connector_changed');

            return;
        }
        if ($this->bindingBlock($fresh['dialog'], $r) !== null) {
            $this->finish($r, 'waiting', 'current_session_case_unverified');

            return;
        }
        $reason = SalesTransferWindow::blockReason($window);
        if ($reason || CarbonImmutable::parse($r->deadline_at)->lte(now())) {
            $this->finish($r, $reason ? SalesTransferWindow::blockedState($reason) : 'needs_attention', $reason ?? 'retry_deadline_elapsed');

            return;
        }

        if (! $lock->isOwnedByCurrentProcess()) {
            return;
        }
        $query = self::scoped()->where('id', $r->id);
        $intent = now()->utc()->startOfSecond();
        if ((clone $query)->whereNull('intent_at')->whereIn('state', ['pending', 'waiting'])->update([
            'intent_at' => $intent, 'owner_before' => $fresh['owner_id'], 'state' => 'reconciling',
            'reason' => 'post_outcome_unverified', 'available_at' => now()->addMinute(), 'updated_at' => now(),
        ]) !== 1) {
            return;
        }
        if (! $lock->isOwnedByCurrentProcess() || SalesTransferWindow::blockReason($window) !== null) {
            // This process knows it hasn't sent anything. Returning without clearing the intent is conservative across a lease loss.
            return;
        }
        $ack = $this->crm->call('imopenlines.operator.transfer', ['CHAT_ID' => $chat, 'USER_ID' => $target]);
        if ($ack === true) {
            $query->update(['acknowledged' => true, 'updated_at' => now()]);
        }
        $this->reconcile($query->first());
    }

    /** Prevent a historical deal from occupying the only delivery slot for a reused chat. A repeat receipt requires no provider read. */
    public function reservationBlock(object $r): ?string
    {
        try {
            $dialog = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $r->chat_id]);
            $source = explode('|', (string) ($dialog['entity_id'] ?? ''));
            $tuple = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
            $enabled = $dialog['text_field_enabled'] ?? null;
            if ((string) ($dialog['id'] ?? '') !== (string) $r->chat_id || ($dialog['entity_type'] ?? '') !== 'LINES'
                || count($source) !== 4 || $source[0] !== 'whatsappbyedna' || $source[1] !== '1'
                || ! ctype_digit($tuple[5] ?? '') || ! in_array($enabled, [true, false, 'Y', 'N', 'y', 'n', 1, 0, '1', '0'], true)) {
                return 'case_binding_unverified';
            }
            if ($tuple[5] !== (string) $r->session_id || ! in_array($enabled, [true, 'Y', 'y', 1, '1'], true)) {
                return 'session_closed_or_replaced';
            }

            return $this->bindingBlock($dialog, $r);
        } catch (Throwable) {
            return 'case_binding_unverified';
        }
    }

    private function bindingBlock(array $dialog, object $r): ?string
    {
        // crm.chat.get also includes previous sessions. The current native dialog must agree with this request.
        $case = (new EdnaOrganicAttention($this->crm))->caseBindings($dialog);
        $bindings = $case['bindings'];
        if ($case['primary_id'] !== '') {
            $bindings[$case['primary_entity']] = $case['primary_id'];
        }
        foreach (['lead' => $r->lead_id, 'deal' => $r->deal_id, 'contact' => $r->contact_id] as $type => $id) {
            if ($id !== null && isset($bindings[$type]) && $bindings[$type] !== (string) $id) {
                return 'case_binding_mismatch';
            }
        }

        return isset($bindings['lead']) || isset($bindings['deal']) ? null : 'case_binding_unverified';
    }

    /** The producer may reserve this request before it commits the lead and deal assignments. */
    private function assignmentBlock(object $r): ?string
    {
        $deal = $this->crm->call('crm.item.get', ['entityTypeId' => 2, 'id' => (int) $r->deal_id])['item'] ?? null;
        $lead = $this->crm->call('crm.lead.get', ['id' => (int) $r->lead_id]);
        if ((string) ($deal['id'] ?? '') !== (string) $r->deal_id || (string) ($lead['ID'] ?? '') !== (string) $r->lead_id) {
            return 'commercial_identity_unverified';
        }
        if ((string) ($deal['leadId'] ?? '') !== (string) $r->lead_id
            || ($r->contact_id !== null && (string) ($deal['contactId'] ?? '') !== (string) $r->contact_id)
            || (string) ($deal['assignedById'] ?? '') !== (string) $r->target_id || ($deal['stageId'] ?? '') !== $r->stage_id
            || (string) ($lead['ASSIGNED_BY_ID'] ?? '') !== (string) $r->target_id) {
            return 'commercial_assignment_pending_or_changed';
        }

        // A contact can have multiple unrelated loans. The exact chat must still be linked to this deal or its lead.
        foreach (['deal' => $r->deal_id, 'lead' => $r->lead_id] as $entity => $id) {
            $linked = $this->crm->call('imopenlines.crm.chat.get', ['CRM_ENTITY_TYPE' => $entity, 'CRM_ENTITY' => (int) $id, 'ACTIVE_ONLY' => 'N']);
            if (! is_array($linked) || ! array_is_list($linked)) {
                return 'commercial_chat_binding_unverified';
            }
            foreach ($linked as $chat) {
                if ((string) ($chat['CHAT_ID'] ?? $chat['chat_id'] ?? '') === (string) $r->chat_id) {
                    return null;
                }
            }
        }

        return 'commercial_chat_binding_unverified';
    }

    /** Respect writes already attempted by a previous local owner, even if native indexing or acknowledgement was lost. */
    private function priorLocalIntent(int $chat, int $session): bool
    {
        foreach (['edna_benefit_chat_routes', 'edna_organic_menus', 'sales_inbox_sessions'] as $table) {
            if (DB::table($table)->where('chat_id', $chat)->where('session_id', $session)
                ->whereNotNull($table === 'sales_inbox_sessions' ? 'intent' : 'transfer_intent')->exists()) {
                return true;
            }
        }
        // On PostgreSQL intake proof is historical TEXT while the web receipt uses JSON.
        $cast = DB::connection()->getDriverName() === 'pgsql';
        $chatSql = $cast ? "(proof::jsonb ->> 'chat_id')" : "CAST(json_extract(proof, '$.chat_id') AS TEXT)";
        $sessionSql = $cast ? "(proof::jsonb ->> 'session_id')" : "CAST(json_extract(proof, '$.session_id') AS TEXT)";
        return DB::table('web_form_chat_routes')->whereNotNull('proof->transfer_intent')
            ->whereRaw("$chatSql = ? and $sessionSql = ?", [(string) $chat, (string) $session])->exists()
            || DB::table('edna_intake_chat_routes')->whereNotNull('transfer_intent')
                ->whereRaw("$chatSql = ? and $sessionSql = ?", [(string) $chat, (string) $session])->exists();
    }

    private function reconcile(object $r): void
    {
        $fingerprint = SalesNativeTransfer::fingerprint($this->crm, (int) $r->chat_id, (int) $r->session_id,
            (int) $r->target_id, CarbonImmutable::parse($r->intent_at, 'UTC'), (int) $r->owner_before);
        if ($fingerprint !== null) {
            $this->finish($r, $r->acknowledged ? 'confirmed' : 'observed', 'native_transfer_found', $fingerprint);
        } else {
            $this->finish($r, 'reconciling', 'post_outcome_unverified');
        }
    }

    private function finish(object $r, string $state, string $reason, ?string $fingerprint = null): void
    {
        $next = null;
        if (in_array($state, ['waiting', 'reconciling'], true)) {
            $deadline = CarbonImmutable::parse($r->deadline_at);
            if ($deadline->lte(now()) || $r->attempts >= 64) {
                $state = 'needs_attention';
            } else {
                $delay = (new WebFormChatRetryPolicy)->delaySeconds((int) $r->attempts, 900);
                $next = CarbonImmutable::now()->addSeconds($delay)->min($deadline);
            }
        }
        $query = self::scoped()->where('id', $r->id);
        // A stale preflight can never overwrite an intent already claimed by another worker.
        if ($r->intent_at) {
            $query->whereNotNull('intent_at')->where('state', 'reconciling');
        } else {
            $query->whereNull('intent_at')->whereIn('state', ['pending', 'waiting']);
        }
        $outage = [];
        if ($reason === 'customer_window_unknown' && $r->available_at && $state === 'waiting') {
            $outage = ['unverified_checks' => DB::raw('unverified_checks + 1'),
                'first_unverified_at' => $r->first_unverified_at ?? now(), 'last_unverified_at' => now()];
        }
        $query->update($outage + ['state' => $state, 'reason' => $reason, 'available_at' => $next,
            'native_event_sha256' => $fingerprint, 'updated_at' => now()]);
    }
}
