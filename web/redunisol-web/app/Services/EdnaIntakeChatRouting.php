<?php

namespace App\Services;

use App\Jobs\RouteEdnaIntakeChat;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

/** Routes only a new, acknowledged existing case. Uncertain POSTs are reconciled, never repeated. */
class EdnaIntakeChatRouting
{
    public function route(int $requestId): void
    {
        $row = DB::transaction(function () use ($requestId) {
            $row = DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->lockForUpdate()->first();
            if (! $row || ! in_array($row->state, ['pending', 'sending', 'unknown'], true)
                || ($row->lease_until && CarbonImmutable::parse($row->lease_until)->isFuture())) {
                return null;
            }
            DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->update(['lease_until' => now()->addSeconds(115)]);

            return $row;
        });
        if (! $row) {
            return;
        }
        $lock = null;
        try {
            $request = DB::table('edna_intake_requests')->find($requestId);
            $send = $request ? DB::table('edna_flow_sends')->find($request->flow_send_id) : null;
            if (! $send || $request->state !== 'synced' || ! app(EdnaFreshIntake::class)->applies($send)
                || ! config('edna.enabled') || ! config('edna.intake_crm_enabled')) {
                $this->finish($requestId, 'preserved', 'fresh_intake_gate_changed');

                return;
            }
            $proof = json_decode($row->proof, true, 16, JSON_THROW_ON_ERROR);
            if ($proof !== app(EdnaIntakeBinding::class)->verified($send)) {
                throw new RuntimeException('Fresh route binding changed.');
            }
            $case = json_decode($row->assigned_case, true, 16, JSON_THROW_ON_ERROR);
            $independent = isset($case['request_uuid']);
            $verifiedContact = isset($case['contact_deal_stage']) ? (string) $case['contact_id'] : null;
            $attention = app(EdnaOrganicAttention::class);
            $crm = app(EdnaBitrix::class);
            $store = Cache::getStore();
            if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
                throw new RuntimeException('Shared chat lock unavailable.');
            }
            $lock = Cache::lock('web-form-chat:'.$proof['chat_id'], 115);
            if (! $lock->get()) {
                throw new RuntimeException('Chat routing in progress.');
            }
            if (in_array($row->state, ['sending', 'unknown'], true)) {
                $intent = json_decode($row->transfer_intent ?? '{}', true, 32, JSON_THROW_ON_ERROR);
                $target = (int) ($intent['target_id'] ?? 0);
                $snapshot = $attention->snapshot($proof);
                $owner = $snapshot['dialog_tuple']['owner'];
                if ($owner === (string) $target && isset($intent['snapshot'])
                    && $attention->compatible($intent['snapshot'], $snapshot, $target, true, false, $verifiedContact, $independent, $independent ? $case['lead_id'] : null)
                    && $this->caseSnapshot($case, $crm) === ($intent['commercial_case'] ?? null)) {
                    $this->finish($requestId, $row->transfer_acknowledged ? 'confirmed' : 'observed',
                        $row->transfer_acknowledged ? 'target_confirmed' : 'target_observed');
                } elseif ($owner !== (string) ($intent['owner_before'] ?? '')) {
                    $this->finish($requestId, 'preserved', 'human_assignment_after_transfer');
                } else {
                    throw new RuntimeException('Transfer outcome remains uncertain.');
                }

                return;
            }
            if ($independent && ($case['request_uuid'] !== $send->request_id || (string) $request->lead_id !== $case['lead_id'])) {
                $this->finish($requestId, 'preserved', 'fresh_request_binding_changed');

                return;
            }
            $expires = $independent ? (new EdnaFreshCaseRoute)->expiresAt($send, $request, $proof, $crm) : null;
            if ($expires && $expires->gt(CarbonImmutable::parse($request->received_at)->addDay())
                && ($case['verified_window_until'] ?? null) !== $expires->toIso8601String()) {
                // The probe can discover an extension proved by this worker without polling Bitrix.
                $case['verified_window_until'] = $expires->toIso8601String();
                DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->where('state', 'pending')
                    ->update(['assigned_case' => json_encode($case, JSON_THROW_ON_ERROR)]);
            }
            if ($independent && $expires->lte(now())) {
                $this->finish($requestId, 'expired', 'fresh_declaration_window_elapsed');

                return;
            }
            $beforeCase = $this->caseSnapshot($case, $crm);
            if ($independent && $beforeCase['state'] !== 'assigned') {
                if ($beforeCase['state'] === 'waiting') {
                    // Only this request wakes up again. Bound the delay by the
                    // authenticated customer's response, including over weekends.
                    $age = max(0, CarbonImmutable::parse($request->received_at)->diffInSeconds(now()));
                    $delay = min(random_int(15, max(15, min(1800, (int) $age))), max(1, (int) now()->diffInSeconds($expires, false)));
                    $this->finish($requestId, 'pending', $beforeCase['reason']);
                    Queue::connection('edna')->later($delay, new RouteEdnaIntakeChat($requestId), '', 'edna');
                } else {
                    $this->finish($requestId, 'preserved', $beforeCase['reason']);
                }

                return;
            }
            $target = (int) ($independent ? $beforeCase['seller_id'] : $case['seller_id']);
            if (! $attention->targetActive($target)) {
                $this->finish($requestId, 'review', 'routing_target_unavailable');

                return;
            }
            if (! $beforeCase) {
                $this->finish($requestId, 'preserved', 'commercial_assignment_changed');

                return;
            }
            $before = $attention->inspect($proof, $target);
            if (($before['status'] ?? '') === 'already_assigned') {
                $this->finish($requestId, 'not_needed', 'already_with_target');

                return;
            }
            if (($before['status'] ?? '') !== 'ready' || ! $attention->canTransfer($before['native_snapshot'] ?? [], $target, false, $verifiedContact, $independent)) {
                if (($before['status'] ?? '') === 'waiting') {
                    throw new RuntimeException('Native attention reads pending.');
                }
                $this->finish($requestId, 'preserved', $before['reason'] ?? 'native_assignment_preserved');

                return;
            }
            // Recheck the commercial identity first, then live human attention last.
            if ($this->caseSnapshot($case, $crm) !== $beforeCase) {
                $this->finish($requestId, 'preserved', 'commercial_assignment_changed');

                return;
            }
            $fresh = $attention->inspect($proof, $target);
            if (($fresh['status'] ?? '') !== 'ready'
                || ! $attention->compatible($before['native_snapshot'], $fresh['native_snapshot'] ?? [], $target, false, false, $verifiedContact, $independent)) {
                if (($fresh['status'] ?? '') === 'waiting') {
                    throw new RuntimeException('Final attention reads pending.');
                }
                $this->finish($requestId, 'preserved', $fresh['reason'] ?? 'attention_changed_before_transfer');

                return;
            }
            if ($independent && $expires->lte(now()->addSeconds(6))) {
                $this->finish($requestId, 'expired', 'whatsapp_window_expired');

                return;
            }
            if ($independent && ! (new EdnaFreshCaseRoute)->protectsHistoricalOwners($fresh['native_snapshot'], $case, $target, $crm)) {
                $this->finish($requestId, 'preserved', 'native_crm_transfer_would_change_owner');

                return;
            }
            if ($verifiedContact !== null && ! $attention->confirmContactDeal($proof, $fresh['native_snapshot'],
                $verifiedContact, (string) $case['deal_id'], $target, $case['contact_deal_stage'])) {
                $this->finish($requestId, 'preserved', 'contact_deal_or_attention_changed');

                return;
            }
            $intent = ['target_id' => (string) $target, 'session_id' => $proof['session_id'],
                'owner_before' => (string) $fresh['owner_id'], 'created_at' => now()->toIso8601String(),
                'snapshot' => $fresh['native_snapshot'], 'commercial_case' => $beforeCase];
            if (! $lock->isOwnedByCurrentProcess() || DB::table('edna_intake_chat_routes')->where('request_id', $requestId)
                ->where('state', 'pending')->where('lease_until', '>', now()->addSeconds(6))->update([
                'state' => 'sending', 'transfer_intent' => json_encode($intent, JSON_THROW_ON_ERROR), 'updated_at' => now(),
            ]) !== 1) {
                throw new RuntimeException('Fresh chat transfer lease expired.');
            }
            try {
                $ack = $crm->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $proof['chat_id'], 'USER_ID' => $target]);
                DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->update([
                    'state' => 'unknown', 'transfer_acknowledged' => $ack === true, 'updated_at' => now(),
                ]);
            } catch (Throwable) {
                DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->update(['state' => 'unknown', 'updated_at' => now()]);
            }
            $this->finish($requestId, 'unknown', 'transfer_reconciliation_pending');
            // A new queued attempt performs reads only because the intent is durable.
            throw new RuntimeException('Transfer requires read-only reconciliation.');
        } finally {
            try {
                $lock?->release();
            } finally {
                DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->update(['lease_until' => null]);
            }
        }
    }

    private function caseSnapshot(array $case, EdnaBitrix $crm): ?array
    {
        if (isset($case['request_uuid'])) {
            return (new EdnaFreshCaseRoute)->target($case, $crm);
        }
        $deal = $crm->call('crm.deal.get', ['id' => $case['deal_id']]);
        $lead = in_array($case['lead_id'] ?? null, ['', '0', 0, null], true) ? '' : (string) $case['lead_id'];
        $currentLead = in_array($deal['LEAD_ID'] ?? null, ['', '0', 0, null], true) ? '' : (string) $deal['LEAD_ID'];
        if (! is_array($deal) || (string) ($deal['ID'] ?? '') !== (string) $case['deal_id']
            || (string) ($deal['ASSIGNED_BY_ID'] ?? '') !== (string) $case['seller_id']
            || (string) ($deal['CONTACT_ID'] ?? '') !== (string) $case['contact_id']
            || $currentLead !== $lead
            || (string) ($deal['CATEGORY_ID'] ?? '') !== '1' || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P') {
            return null;
        }
        foreach (['contact' => [(string) $case['contact_id'], 'UF_CRM_65B7E48033FCD'], 'lead' => [$lead, 'UF_CRM_1693840106704']] as $entity => [$id, $field]) {
            if ($id === '') {
                continue;
            }
            $record = $crm->call('crm.'.$entity.'.get', ['id' => $id]);
            $identity = is_string($record[$field] ?? null) ? (new WebFormReceipt)->identityHash($record[$field]) : null;
            if ((string) ($record['ID'] ?? '') !== $id || ! $identity || ! hash_equals($case['identity_hash'], $identity)
                || ($entity === 'lead' && ! in_array($record['CONTACT_ID'] ?? null, ['', '0', 0, null], true)
                    && (string) $record['CONTACT_ID'] !== (string) $case['contact_id'])) {
                return null;
            }
        }

        return array_intersect_key($deal, array_flip(['ID', 'ASSIGNED_BY_ID', 'CONTACT_ID', 'LEAD_ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID']));
    }

    private function finish(int $requestId, string $state, string $reason): void
    {
        DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->update([
            'state' => $state, 'reason' => $reason, 'updated_at' => now(),
        ]);
        try {
            $row = DB::table('edna_intake_chat_routes')->where('request_id', $requestId)->first();
            $proof = json_decode($row->proof, true, 16, JSON_THROW_ON_ERROR);
            app(JourneyLedger::class)->record('whatsapp.native_intake_route', [
                'state' => $state, 'reason' => $reason, 'chat_id' => $proof['chat_id'],
                'native_session_id' => $proof['session_id'], 'message_id' => $proof['message_id'],
                'entry_event_id' => $proof['entry_event_id'], 'transfer_state' => $state,
                'transfer_acknowledged' => (bool) $row->transfer_acknowledged,
                'transfer_intent' => $row->transfer_intent ? json_decode($row->transfer_intent, true) : null,
            ], ['intake_request_id' => (string) $requestId], 'whatsapp.edna');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) {
            // The durable receipt is authoritative even when journaling is unavailable.
        }
    }
}
