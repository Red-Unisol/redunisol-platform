<?php

namespace App\Services;

use App\Support\BitrixSellerRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** An independent declaration follows only the deal converted from its own lead. */
class EdnaFreshCaseRoute
{
    /** Extend the guaranteed Flow-response window only with an authenticated inbound in this session. */
    public function expiresAt(object $send, object $request, array $proof, EdnaBitrix $crm): CarbonImmutable
    {
        $expires = CarbonImmutable::parse($request->received_at)->addDay();
        if ($expires->gt(now()->addMinute())) {
            return $expires;
        }
        $history = $crm->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $proof['session_id']]);
        if ((string) ($history['chatId'] ?? '') !== (string) $proof['chat_id']
            || (string) ($history['sessionId'] ?? '') !== (string) $proof['session_id']
            || ($history['hasNextPage'] ?? null) !== false || ! is_array($history['message'] ?? null)) {
            throw new RuntimeException('Current session history is unavailable.');
        }
        $ids = [];
        foreach ($history['message'] as $message) {
            $sender = $history['users'][(string) ($message['senderid'] ?? '')] ?? null;
            if ((string) ($message['chatid'] ?? '') !== (string) $proof['chat_id'] || ($sender['connector'] ?? null) !== true) {
                continue;
            }
            $params = $message['params'] ?? [];
            $params = is_string($params) ? json_decode($params, true, 16, JSON_THROW_ON_ERROR) : $params;
            foreach ((array) ($params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? []) as $mid) {
                if ((is_string($mid) || is_int($mid)) && ctype_digit((string) $mid)) {
                    $ids[(string) $mid] = (string) $mid;
                }
            }
        }
        $phone = Crypt::decryptString($send->recipient);
        foreach (array_chunk($ids, 100) as $batch) {
            foreach (DB::table('edna_incoming_events')->where('subject_id', $send->subject_id)->whereIn('message_id', $batch)->get() as $event) {
                $body = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
                if (($body['id'] ?? null) !== $event->message_id || ($body['subjectId'] ?? null) !== $send->subject_id
                    || ($body['subscriber']['identifier'] ?? null) !== $phone || empty($body['messageContent']['type'])
                    || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', (string) ($body['receivedAt'] ?? ''))) {
                    continue;
                }
                $at = CarbonImmutable::parse($body['receivedAt']);
                if ($at->lte(now())) {
                    $expires = $expires->max($at->addDay());
                }
            }
        }

        return $expires;
    }

    public function target(array $case, EdnaBitrix $crm, ?array $proof = null): array
    {
        $lead = $crm->call('crm.lead.get', ['id' => $case['lead_id']]);
        $identity = (new WebFormReceipt)->identityHash((string) ($lead['UF_CRM_1693840106704'] ?? ''));
        if ((string) ($lead['ID'] ?? '') !== $case['lead_id'] || ($lead['ORIGINATOR_ID'] ?? '') !== 'redunisol.edna.fresh-v3'
            || ($lead['ORIGIN_ID'] ?? '') !== $case['request_uuid'] || ($lead['UF_CRM_WA_ASSISTANCE_ID'] ?? '') !== $case['request_uuid']
            || ! $identity || ! is_string($case['identity_hash'] ?? null) || ! hash_equals($case['identity_hash'], $identity)) {
            return ['state' => 'preserved', 'reason' => 'fresh_request_identity_changed'];
        }
        if (($lead['STATUS_SEMANTIC_ID'] ?? '') === 'F') {
            return ['state' => 'preserved', 'reason' => 'fresh_request_closed'];
        }
        $deals = $crm->call('crm.deal.list', ['filter' => ['=LEAD_ID' => $case['lead_id'], '=CATEGORY_ID' => 1],
            'select' => ['ID', 'LEAD_ID', 'CATEGORY_ID', 'CONTACT_ID', 'CLOSED', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
                'ASSIGNED_BY_ID', 'UF_CRM_KQ_REASON', 'UF_CRM_KQ_ACTION'], 'start' => -1]);
        if (! is_array($deals) || ! array_is_list($deals)) {
            throw new RuntimeException('Incomplete commercial assignment response.');
        }
        if ($deals === []) {
            return ['state' => 'waiting', 'reason' => 'fresh_request_waiting_deal'];
        }
        $deal = $deals[0];
        if (count($deals) !== 1 || (string) ($deal['LEAD_ID'] ?? '') !== $case['lead_id']
            || (string) ($deal['CATEGORY_ID'] ?? '') !== '1' || ! ctype_digit((string) ($deal['ID'] ?? ''))) {
            return ['state' => 'preserved', 'reason' => 'fresh_request_deal_ambiguous'];
        }
        if (($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P' || ($deal['CLOSED'] ?? '') !== 'N') {
            return ['state' => 'preserved', 'reason' => 'fresh_request_deal_closed'];
        }
        $stage = $deal['STAGE_ID'] ?? '';
        $seller = (string) ($deal['ASSIGNED_BY_ID'] ?? '');
        $contact = (string) ($deal['CONTACT_ID'] ?? '');
        $contact = $contact === '0' ? '' : $contact;
        $leadContact = (string) ($lead['CONTACT_ID'] ?? '');
        if ($contact !== ($leadContact === '0' ? '' : $leadContact)) {
            return ['state' => 'preserved', 'reason' => 'fresh_request_contact_changed'];
        }
        if ($contact !== '') {
            $person = $crm->call('crm.contact.get', ['id' => $contact]);
            if ((string) ($person['ID'] ?? '') !== $contact
                || (new WebFormReceipt)->identityHash((string) ($person['UF_CRM_65B7E48033FCD'] ?? '')) !== $identity) {
                return ['state' => 'preserved', 'reason' => 'fresh_request_contact_changed'];
            }
        }
        if ($stage === 'C1:5') {
            return ['state' => 'preserved', 'reason' => 'fresh_request_deal_rejected'];
        }
        if (! str_starts_with($stage, 'C1:') || (str_starts_with($stage, 'C1:KESTRA_')
                && ! ($stage === 'C1:KESTRA_REVIEW' && $this->verifiedReviewSeller($case, $deal, $proof)))
            || ! ctype_digit($seller) || in_array($seller, ['0', '57', '71283', '74827'], true)) {
            return ['state' => 'waiting', 'reason' => 'fresh_request_waiting_seller'];
        }
        if (! in_array((int) $seller, array_map('intval', app(BitrixSellerRegistry::class)->enabledIds()), true)) {
            return ['state' => 'preserved', 'reason' => 'commercial_seller_unavailable'];
        }

        return ['state' => 'assigned', 'deal_id' => (string) $deal['ID'], 'seller_id' => $seller,
            'stage' => $stage, 'lead_id' => $case['lead_id'], 'contact_id' => $contact];
    }

    private function verifiedReviewSeller(array $case, array $deal, ?array $proof): bool
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || empty($proof['entry_event_id'])
            || empty($proof['chat_id']) || empty($proof['session_id']) || ! array_key_exists('UF_CRM_KQ_ACTION', $deal)
            || ! in_array($deal['UF_CRM_KQ_ACTION'], [null, false, ''], true)) {
            return false;
        }
        // Kestra commits this receipt together with the seller and the credit-review stage.
        $expected = implode(':', [EdnaFreshIntake::REVIEW_SELLER, $case['request_uuid'], $case['lead_id'],
            $deal['ID'], $proof['chat_id'], $proof['session_id'], $deal['ASSIGNED_BY_ID']]);
        if (($deal['UF_CRM_KQ_REASON'] ?? null) !== $expected) {
            return false;
        }
        $event = DB::table('edna_incoming_events')->find($proof['entry_event_id']);

        return $event && $event->message_id === ($proof['entry_message_id'] ?? null)
            && app(EdnaFreshIntake::class)->entry($event, EdnaFreshIntake::REVIEW_SELLER);
    }

    public function protectsHistoricalOwners(array $snapshot, array $case, int $target, EdnaBitrix $crm): bool
    {
        $crmMayReassign = false;
        foreach ($snapshot['records'] as $record) {
            if ($record['owner'] === (string) $target) {
                continue;
            }
            if ($record['entity'] === 'lead' && $record['id'] === $case['lead_id']) {
                if (self::provisionalOwnLead($record, $case['lead_id'])) {
                    continue;
                }
                // Manual reassignment of our own lead must survive too.
                return false;
            }
            $crmMayReassign = true;
        }
        if (! $crmMayReassign) {
            return true;
        }
        // With CRM_TRANSFER_CHANGE, Bitrix can silently assign any bound
        // record. Only allow the transfer if it cannot change its owner.
        $config = $crm->call('imopenlines.config.get', ['CONFIG_ID' => 1]);

        return (string) ($config['ID'] ?? '') === '1' && ($config['CRM_TRANSFER_CHANGE'] ?? null) === 'N';
    }

    public static function provisionalOwnLead(array $record, ?string $leadId): bool
    {
        return $leadId !== null && $record['entity'] === 'lead' && $record['id'] === $leadId
            && ($record['owner'] === '71283' && $record['creator'] === '71283'
                || in_array($record['owner'], ['0', ''], true));
    }
}
