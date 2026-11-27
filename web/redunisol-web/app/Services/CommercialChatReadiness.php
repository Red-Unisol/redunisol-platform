<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** The queue probes receipts in batches. Only a selected case incurs live attention reads. */
class CommercialChatReadiness
{
    public function __construct(private EdnaBitrix $crm, private EdnaOrganicAttention $attention) {}

    public function check(array $cases, bool $live): array
    {
        $results = [];
        $withoutChat = [];
        foreach ($cases as $case) {
            $case = array_intersect_key($case, array_flip(['deal_id', 'request_id', 'lead_id', 'channel']));
            $id = (int) $case['deal_id'];
            $results[$id] = $case + ['state' => 'waiting'];
            $evidence = $case['channel'] === 'web' ? $this->web($case) : $this->v3($case, $live);
            if ($evidence === null) {
                continue;
            }
            if ($evidence === []) {
                $withoutChat[$id] = $case;

                continue;
            }
            [$proof, $expires] = $evidence;
            if ($expires->lte(now()) || ($proof['verified'] ?? null) !== true
                || ($proof['source'] ?? '') !== 'bitrix_openline_session' || ($proof['evidence'] ?? '') !== 'external_message_id'
                || ! ctype_digit((string) ($proof['session_id'] ?? '')) || ! ctype_digit((string) ($proof['chat_id'] ?? ''))) {
                continue;
            }
            if ($live) {
                if (! $this->currentDeal($case)) {
                    continue;
                }
                $chat = $this->attention->inspectWelcome($proof);
                if (($chat['status'] ?? '') !== 'ready' || ($case['channel'] === 'web'
                    && app(WebFormChatLinker::class)->dialogCaseProblem($chat['dialog'] ?? null, $evidence[2],
                        (string) $proof['commercial_readiness']['contact_id'], (string) $case['deal_id'],
                        (string) $case['lead_id'], (string) ($proof['native_lead_id'] ?? '')))) {
                    continue;
                }
            }
            $results[$id] = $case + ['state' => 'ready', 'chat_id' => (int) $proof['chat_id'],
                'session_id' => (int) $proof['session_id'], 'expires_at' => $expires->utc()->toIso8601String()];
            if ($case['channel'] === 'v3' && $evidence[2] === true) {
                $results[$id]['review_seller'] = true;
            }
        }
        if ($withoutChat) {
            // One search per batch. A named commercial owner or a completed, incoming,
            // automated or unrelated call is never an instruction to choose a seller.
            $cursor = 0;
            do {
                $calls = $this->outboundPage($cursor, ['@OWNER_ID' => array_keys($withoutChat)]);
                if (! is_array($calls) || ! array_is_list($calls) || count($calls) > 50) {
                    throw new \RuntimeException('Incomplete outbound activities response.');
                }
                foreach ($calls as $call) {
                    if ((int) ($call['ID'] ?? 0) <= $cursor) {
                        throw new \RuntimeException('Invalid outbound activity cursor.');
                    }
                    $cursor = (int) $call['ID'];
                    $id = (int) ($call['OWNER_ID'] ?? 0);
                    if (! isset($withoutChat[$id]) || $results[$id]['state'] !== 'waiting' || (int) ($call['OWNER_TYPE_ID'] ?? 0) !== 2
                        || (int) ($call['TYPE_ID'] ?? 0) !== 2 || (int) ($call['DIRECTION'] ?? 0) !== 2 || ($call['COMPLETED'] ?? '') !== 'N'
                        || ! in_array((int) ($call['RESPONSIBLE_ID'] ?? 0), [57, 71283, 74827], true)
                        || ! in_array((int) ($call['AUTHOR_ID'] ?? 0), [57, 74827], true) || (int) ($call['ID'] ?? 0) < 1
                        || empty($call['START_TIME']) || CarbonImmutable::parse($call['START_TIME'])->isFuture()
                        || ($live && ! $this->currentDeal($withoutChat[$id]))) {
                        continue;
                    }
                    $results[$id] = $withoutChat[$id] + ['state' => 'outbound', 'activity_id' => (int) $call['ID']];
                    unset($withoutChat[$id]);
                }
            } while ($withoutChat && count($calls) === 50);
        }

        return array_values($results);
    }

    public function outboundPage(int $after, array $scope): array
    {
        return $this->crm->call('crm.activity.list', ['filter' => $scope + ['=OWNER_TYPE_ID' => 2, '>ID' => $after,
            '=TYPE_ID' => 2, '=DIRECTION' => 2, '=COMPLETED' => 'N', '@AUTHOR_ID' => [57, 74827],
            '<=START_TIME' => now()->toIso8601String(), '@RESPONSIBLE_ID' => [57, 71283, 74827]],
            'select' => ['ID', 'OWNER_TYPE_ID', 'OWNER_ID', 'AUTHOR_ID', 'RESPONSIBLE_ID', 'TYPE_ID', 'DIRECTION', 'COMPLETED', 'START_TIME'],
            'order' => ['ID' => 'ASC'], 'start' => -1]);
    }

    private function currentDeal(array $case): bool
    {
        $deal = $this->crm->call('crm.deal.get', ['id' => $case['deal_id']]);

        return (string) ($deal['ID'] ?? '') === (string) $case['deal_id']
            && (string) ($deal['LEAD_ID'] ?? '') === (string) $case['lead_id']
            && (string) ($deal['CATEGORY_ID'] ?? '') === '1' && ($deal['CLOSED'] ?? '') === 'N'
            && ! isset(EdnaRejectedDealDiscovery::STAGE_REASONS[$deal['STAGE_ID'] ?? ''])
            && ($deal['STAGE_SEMANTIC_ID'] ?? '') === 'P';
    }

    private function web(array $case): ?array
    {
        $receipt = DB::table('web_form_receipts')->where('id', $case['request_id'])->where('lead_id', (string) $case['lead_id'])
            ->where('state', 'synced')->first();
        if (! $receipt || ! app(EdnaFreshIntake::class)->webOwnership($receipt->received_at)
            || app(WebFormChatLinker::class)->webRevisionBlock($receipt)) {
            return null;
        }
        $latest = DB::table('web_form_chat_routes')->where('submission_id', $receipt->id)->orderByDesc('entry_event_id')->first();
        if (! $latest) {
            return [];
        }
        $proof = json_decode($latest->proof ?? '{}', true, 32, JSON_THROW_ON_ERROR);
        $signal = $proof['commercial_readiness'] ?? [];
        if (! in_array($latest->state, ['waiting', 'processing', 'pending'], true) || $latest->transfer_state !== 'pending'
            || isset($proof['transfer_intent']) || ! empty($proof['protected_assignment'])
            || (string) $latest->deal_id !== (string) $case['deal_id'] || ($signal['request_id'] ?? '') !== $receipt->id
            || (string) ($signal['deal_id'] ?? '') !== (string) $case['deal_id']
            || (string) ($signal['lead_id'] ?? '') !== (string) $case['lead_id'] || empty($signal['contact_id'])
            || empty($receipt->phone_hash) || empty($signal['expires_at'])) {
            return null;
        }

        return [$proof, CarbonImmutable::parse($signal['expires_at']), (string) $receipt->phone_hash];
    }

    private function v3(array $case, bool $live): ?array
    {
        $send = DB::table('edna_flow_sends')->where('request_id', $case['request_id'])->where('state', 'completed')->first();
        if (! $send) {
            return null;
        }
        $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
        if (! $entry || ! app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::OWNERSHIP)) {
            return null;
        }
        $request = DB::table('edna_intake_requests')->where('flow_send_id', $send->id)->where('lead_id', (string) $case['lead_id'])
            ->where('state', 'synced')->first();
        $route = $request ? DB::table('edna_intake_chat_routes')->where('request_id', $request->id)->where('state', 'pending')->first() : null;
        if (! $route || $route->transfer_intent) {
            return null;
        }
        $assigned = json_decode($route->assigned_case, true, 16, JSON_THROW_ON_ERROR);
        $proof = json_decode($route->proof, true, 16, JSON_THROW_ON_ERROR);
        if (($assigned['request_uuid'] ?? '') !== $case['request_id'] || ($assigned['lead_id'] ?? '') !== (string) $case['lead_id']
            || $proof !== app(EdnaIntakeBinding::class)->verified($send)) {
            return null;
        }
        $expires = CarbonImmutable::parse($request->received_at)->addDay();
        if (! empty($assigned['verified_window_until'])) {
            $expires = $expires->max(CarbonImmutable::parse($assigned['verified_window_until']));
        }
        if ($live && $expires->lte(now())) {
            $expires = (new EdnaFreshCaseRoute)->expiresAt($send, $request, $proof, $this->crm);
        }

        return [$proof, $expires, app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::REVIEW_SELLER)];
    }
}
