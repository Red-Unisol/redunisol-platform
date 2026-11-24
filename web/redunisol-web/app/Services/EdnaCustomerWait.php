<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Called only after the inbox verifies the native session and lack of human attention. */
class EdnaCustomerWait
{
    public function expired(int $sessionId, int $chatId, string $latestCustomerDate, int $latestCustomerMessageId): bool
    {
        $due = $this->dueAt($sessionId, $chatId, $latestCustomerDate, $latestCustomerMessageId);

        return $due !== null && $due->lte(CarbonImmutable::now('UTC'));
    }

    public function dueAt(int $sessionId, int $chatId, string $latestCustomerDate, int $latestCustomerMessageId): ?CarbonImmutable
    {
        if ($sessionId <= 0 || $chatId <= 0 || $latestCustomerMessageId <= 0
            || ! preg_match('/(?:Z|[+-]\d{2}:\d{2})$/D', $latestCustomerDate)) {
            return null;
        }
        $lastInbound = CarbonImmutable::parse($latestCustomerDate)->utc();
        if (DB::table('web_chat_contexts')->where('chat_id', $chatId)->where('session_id', $sessionId)->exists()) {
            return null;
        }
        $menu = DB::table('edna_organic_menus')->where('chat_id', $chatId)->where('session_id', $sessionId)
            ->where('subject_id', (string) config('edna.subject_id'))->first();
        $bindings = DB::table('edna_intake_bindings')->where('native_session_id', $sessionId)->where('state', 'verified')
            ->limit(2)->pluck('flow_send_id');
        if ($bindings->count() > 1) {
            return null;
        }
        // An unsent fallback menu can explicitly yield ownership to a verified v3 in this session.
        if ($menu && $menu->state === 'preserved' && $menu->reason === 'same_session_v3_preserved'
            && ! $menu->choice_event_id && ! $menu->outgoing_message_id && ! $menu->transfer_intent
            && $bindings->count() === 1) {
            $menu = null;
        }
        if ($menu && ! $menu->choice_event_id) {
            if ($bindings->isNotEmpty() || $menu->flow_send_id || $menu->transfer_intent || $menu->seller_id
                || ! in_array($menu->state, ['awaiting_choice', 'expired'], true) || $menu->send_state !== 'confirmed'
                || ! $menu->outgoing_message_id || ! $menu->confirmed_at) {
                return null;
            }
            $proof = json_decode($menu->proof ?? '', true);
            if (! $this->matches($proof, $sessionId, $chatId, $latestCustomerMessageId)) {
                return null;
            }

            return $this->deadline($menu, $lastInbound, app(EdnaOrganicTransport::class)->deliveryEvidence($menu));
        }
        if ($menu && (! $menu->flow_send_id || $menu->state !== 'flow_scheduled' || $menu->choice !== 'loan' || $menu->transfer_intent
            || ($bindings->isNotEmpty() && (int) $bindings->first() !== (int) $menu->flow_send_id))) {
            return null;
        }
        $flowId = $menu->flow_send_id ?? $bindings->first();
        if (! $flowId) {
            return null;
        }
        $flow = DB::table('edna_flow_sends')->find($flowId);
        if (! $flow || $flow->state !== 'confirmed' || $flow->response_event_id || $flow->completed_at
            || ($menu && ((int) $flow->entry_event_id !== (int) $menu->entry_event_id
                || ! hash_equals(hash_hmac('sha256', 'organic-menu:'.$menu->request_id, (string) config('app.key')), $flow->scope)))
            || ! $flow->accepted_at
            || ! $flow->outgoing_message_id || (string) $flow->subject_id !== (string) config('edna.subject_id')
            || (string) $flow->cascade_id !== (string) config('edna.cascade_id')
            || (string) $flow->flow_id !== (string) config('edna.intake_flow_id') || $flow->intake_test
            || DB::table('edna_intake_requests')->where('flow_send_id', $flowId)->exists()) {
            return null;
        }
        $proof = $menu ? (json_decode($menu->proof ?? '', true)['choice_proof'] ?? null)
            : app(EdnaIntakeBinding::class)->verified($flow);
        if (! $this->matches($proof, $sessionId, $chatId, $latestCustomerMessageId)) {
            return null;
        }

        return $this->deadline($flow, $lastInbound, app(EdnaFlowDelivery::class)->evidence($flow));
    }

    private function matches(?array $proof, int $sessionId, int $chatId, int $messageId): bool
    {
        return ($proof['verified'] ?? false) === true && ($proof['evidence'] ?? '') === 'external_message_id'
            && ($proof['source'] ?? '') === 'bitrix_openline_session' && (int) ($proof['session_id'] ?? 0) === $sessionId
            && (int) ($proof['chat_id'] ?? 0) === $chatId && (int) ($proof['message_id'] ?? 0) === $messageId;
    }

    private function deadline(object $send, CarbonImmutable $lastInbound, array $evidence): ?CarbonImmutable
    {
        if (! in_array($evidence['delivery_status'] ?? '', ['DELIVERED', 'READ'], true)
            || (string) ($evidence['outgoing_message_id'] ?? '') !== (string) $send->outgoing_message_id) {
            return null;
        }
        // History proves delivery, but its message creation timestamp can predate delivery by hours.
        $identity = ['subject_id' => $send->subject_id, 'outgoing_message_id' => $send->outgoing_message_id];
        $rows = DB::table('edna_customer_delivery_observations');
        $rows->insertOrIgnore($identity + ['first_observed_at' => CarbonImmutable::now('UTC')]);
        $first = $rows->where($identity)->value('first_observed_at');

        return $first ? $lastInbound->max(CarbonImmutable::parse($first, 'UTC'))->addDay() : null;
    }
}
