<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

/** Join the verified Edna emission to its Bitrix activity and the exact incoming sales session. */
class EdnaConsentCase
{
    private const TEMPLATE_ID = '58478';

    public function __construct(private EdnaBitrix $crm, private EdnaOrganicAttention $attention) {}

    /** $outbound is the provider receipt verified for this specific button and recipient. */
    public function resolve(array $proof, array $payload, array $outbound): ?array
    {
        if ((string) ($outbound['matcherId'] ?? '') !== self::TEMPLATE_ID) {
            return null;
        }

        return $this->resolution($proof, $payload, $outbound, null)['case'];
    }

    /** The caller supplies the complete authenticated policy receipt and rechecks the result immediately before transfer. */
    public function campaign(array $proof, array $payload, array $receipt): array
    {
        $action = $receipt['action'] ?? '';
        $outbound = $receipt['outbound'] ?? null;
        if (! in_array($action, ['continue', 'offer', 'clarify'], true) || ! is_array($outbound)
            || ! $this->id($outbound['matcherId'] ?? null) || ! is_string($outbound['matcherName'] ?? null)
            || EdnaCampaignTemplate::actionFor($payload, (string) $outbound['matcherId'], $outbound['matcherName']) !== $action) {
            return $this->result('unverified', 'campaign_policy_unverified');
        }

        return $this->resolution($proof, $payload, $outbound, $action);
    }

    private function resolution(array $proof, array $payload, array $outbound, ?string $action): array
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || ! $this->id($proof['entry_message_id'] ?? null)
            || (string) $proof['entry_message_id'] !== (string) ($payload['id'] ?? '')
            || ! $this->id($proof['activity_id'] ?? null) || ! $this->id($proof['message_id'] ?? null)
            || ! $this->id($proof['session_id'] ?? null) || ! $this->id($proof['chat_id'] ?? null)
            || ! $this->id($outbound['messageId'] ?? null)
            || (string) $outbound['messageId'] !== (string) ($payload['replyOutMessageId'] ?? '')
            || ($outbound['uniqueAroundSend'] ?? null) !== true
            || ! is_string($outbound['sentOrReceivedAt'] ?? null)
            || ! preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:?\d\d)$/D', $outbound['sentOrReceivedAt'])
            || (string) ($outbound['subjectId'] ?? '') !== (string) config('edna.subject_id')
            || (string) ($payload['subjectId'] ?? '') !== (string) $outbound['subjectId']) {
            return $this->result('unverified', 'campaign_message_proof_unverified');
        }

        $phone = $payload['subscriber']['identifier'] ?? null;
        if (! is_string($phone) || ! preg_match('/^\+?[0-9]{10,15}$/D', $phone)) {
            return $this->result('unverified', 'campaign_recipient_unverified');
        }
        $phone = ltrim($phone, '+');
        $emission = $this->outgoingActivity($outbound, $phone);
        $send = $emission['row'] ?? null;
        $mayClarify = in_array($action, ['offer', 'clarify'], true);
        if ($emission['status'] === 'conflict' || ($send === null && ! $mayClarify)
            || ($send !== null && (! $this->id($send['OWNER_ID'] ?? null)
                || ! in_array((string) ($send['OWNER_TYPE_ID'] ?? ''), $action === null ? ['2'] : ['1', '2', '3'], true)))) {
            return $this->result('unverified', 'campaign_emission_unverified');
        }
        $tuple = $this->attention->snapshot($proof)['dialog_tuple'];
        if ((string) $proof['chat_id'] !== $tuple['chat_id'] || (string) $proof['session_id'] !== $tuple['session_id']) {
            return $this->result('unverified', 'campaign_session_changed');
        }

        $incoming = $this->crm->call('crm.activity.get', ['id' => $proof['activity_id']]);
        $params = $incoming['PROVIDER_PARAMS'] ?? null;
        $params = is_string($params) ? json_decode($params, true, 16, JSON_THROW_ON_ERROR) : $params;
        $code = $params['USER_CODE'] ?? null;
        $source = is_string($code) ? explode('|', $code) : [];
        if ((string) ($incoming['ID'] ?? '') !== (string) $proof['activity_id']
            || ($incoming['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
            || (string) ($incoming['ASSOCIATED_ENTITY_ID'] ?? '') !== $tuple['session_id']
            || count($source) !== 4 || $source[0] !== 'whatsappbyedna' || $source[1] !== '1'
            || $source[2] !== $phone.'@'.$outbound['subjectId']
            || ! hash_equals($tuple['source_hash'], hash_hmac('sha256', 'organic-source:'.$code, (string) config('app.key')))) {
            return $this->result('unverified', 'campaign_inbound_activity_unverified');
        }
        $entity = ['1' => 'lead', '2' => 'deal', '3' => 'contact'][(string) ($incoming['OWNER_TYPE_ID'] ?? '')] ?? '';
        $nativeId = (string) ($incoming['OWNER_ID'] ?? '');
        $bindings = $tuple['bindings'];
        if ($tuple['primary_id'] !== '') {
            if (isset($bindings[$tuple['primary_entity']]) && $bindings[$tuple['primary_entity']] !== $tuple['primary_id']) {
                return $this->result('unverified', 'campaign_inbound_binding_unverified');
            }
            $bindings[$tuple['primary_entity']] = $tuple['primary_id'];
        }
        if (! $this->id($nativeId) || ($bindings[$entity] ?? null) !== $nativeId) {
            return $this->result('unverified', 'campaign_inbound_binding_unverified');
        }

        $origin = (string) ($send['OWNER_ID'] ?? '');
        $originType = (string) ($send['OWNER_TYPE_ID'] ?? '');
        if ($send === null || $originType === '3') {
            if (! $mayClarify || $entity !== 'contact' || ($send !== null && $origin !== $nativeId)
                || isset($bindings['deal']) || isset($bindings['lead'])) {
                return $this->result('unverified', 'campaign_contact_is_not_a_case');
            }

            return $this->noActiveCase($nativeId, $phone);
        }
        if ($originType === '1' && ($entity === 'deal' || ($entity === 'lead' && $origin === $nativeId))) {
            return $this->leadCase($origin, $bindings, $send, $outbound, $action, $phone);
        }
        if ($entity !== 'deal' || ($originType === '2' && $nativeId !== $origin)) {
            return $this->result('unverified', 'campaign_deal_binding_unverified');
        }

        return $this->dealCase($nativeId, $bindings, $send, $outbound, $action, $phone);
    }

    private function leadCase(string $origin, array $bindings, array $send, array $outbound, string $action, string $phone): array
    {
        $lead = $this->crm->call('crm.lead.get', ['id' => $origin]);
        $contact = (string) ($lead['CONTACT_ID'] ?? '');
        if ((string) ($lead['ID'] ?? '') !== $origin || ! $this->id($contact)
            || (isset($bindings['lead']) && $bindings['lead'] !== $origin)
            || (isset($bindings['contact']) && $bindings['contact'] !== $contact)) {
            return $this->result('unverified', 'campaign_lead_changed');
        }
        if (($lead['STATUS_SEMANTIC_ID'] ?? '') === 'F') {
            if (isset($bindings['deal'])) {
                $boundDeal = $this->crm->call('crm.deal.get', ['id' => $bindings['deal']]);
                if ((string) ($boundDeal['ID'] ?? '') !== $bindings['deal'] || (string) ($boundDeal['LEAD_ID'] ?? '') !== $origin
                    || (string) ($boundDeal['CONTACT_ID'] ?? '') !== $contact || (string) ($boundDeal['CATEGORY_ID'] ?? '') !== '1'
                    || ($boundDeal['CLOSED'] ?? '') !== 'Y' || ! in_array($boundDeal['STAGE_SEMANTIC_ID'] ?? '', ['S', 'F'], true)) {
                    return $this->result('unverified', 'campaign_rejected_lead_deal_conflict');
                }
            }
            return in_array($action, ['offer', 'clarify'], true) ? $this->noActiveCase($contact, $phone) : $this->result('closed', 'campaign_lead_closed');
        }
        if (! in_array($lead['STATUS_SEMANTIC_ID'] ?? '', ['S', 'P'], true)) {
            return $this->result('unverified', 'campaign_lead_state_unknown');
        }
        $related = $this->list('crm.deal.list', ['=LEAD_ID' => $origin, '=CATEGORY_ID' => '1'],
            ['ID', 'LEAD_ID', 'CONTACT_ID', 'CATEGORY_ID']);
        if ($related === [] && ! isset($bindings['deal'])) {
            return $this->result('waiting_assignment', 'campaign_lead_awaiting_deal');
        }
        if (count($related) !== 1 || (string) ($related[0]['LEAD_ID'] ?? '') !== $origin
            || (string) ($related[0]['CONTACT_ID'] ?? '') !== $contact || (string) ($related[0]['CATEGORY_ID'] ?? '') !== '1'
            || ! $this->id($related[0]['ID'] ?? null)) {
            return $this->result('unverified', 'campaign_lead_deal_ambiguous');
        }
        $dealId = (string) $related[0]['ID'];
        if (isset($bindings['deal']) && $bindings['deal'] !== $dealId) {
            return $this->result('unverified', 'campaign_lead_deal_changed');
        }

        return $this->dealCase($dealId, $bindings + ['contact' => $contact], $send, $outbound, $action, $phone);
    }

    private function dealCase(string $dealId, array $bindings, array $send, array $outbound, ?string $action, string $phone): array
    {
        $deal = $this->crm->call('crm.deal.get', ['id' => $dealId]);
        $contact = (string) ($deal['CONTACT_ID'] ?? '');
        $lead = (string) ($deal['LEAD_ID'] ?? '');
        $seller = (string) ($deal['ASSIGNED_BY_ID'] ?? '');
        $stage = (string) ($deal['STAGE_ID'] ?? '');
        if ((string) ($deal['ID'] ?? '') !== $dealId || ! $this->id($contact)
            || (isset($bindings['contact']) && $bindings['contact'] !== $contact)
            || (isset($bindings['lead']) && $bindings['lead'] !== $lead)
            || ((string) $send['OWNER_TYPE_ID'] === '1' && $lead !== (string) $send['OWNER_ID'])
            || (string) ($deal['CATEGORY_ID'] ?? '') !== '1' || ! str_starts_with($stage, 'C1:')) {
            return $this->result('unverified', 'campaign_deal_changed');
        }
        if (($deal['CLOSED'] ?? '') === 'Y' && in_array($deal['STAGE_SEMANTIC_ID'] ?? '', ['S', 'F'], true)) {
            return in_array($action, ['offer', 'clarify'], true) ? $this->noActiveCase($contact, $phone) : $this->result('closed', 'campaign_deal_closed');
        }
        if (($deal['CLOSED'] ?? '') !== 'N' || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P') {
            return $this->result('unverified', 'campaign_deal_state_unknown');
        }

        // A contact with concurrent opportunities requires an unambiguous commercial scope, including Benefits.
        $open = $this->list('crm.deal.list', ['=CONTACT_ID' => $contact, '=STAGE_SEMANTIC_ID' => 'P'],
            ['ID', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'ASSIGNED_BY_ID']);
        if (count($open) !== 1 || (string) ($open[0]['ID'] ?? '') !== $dealId
            || (string) ($open[0]['CONTACT_ID'] ?? '') !== $contact || (string) ($open[0]['CATEGORY_ID'] ?? '') !== '1'
            || ($open[0]['STAGE_ID'] ?? '') !== $stage || (string) ($open[0]['ASSIGNED_BY_ID'] ?? '') !== $seller) {
            return $this->result('unverified', 'campaign_open_deal_conflict');
        }
        if (in_array($stage, ['C1:KESTRA_PENDING', 'C1:KESTRA_QUEUE'], true)) {
            return $this->result('waiting_assignment', 'campaign_waiting_for_distribution');
        }
        if (str_starts_with($stage, 'C1:KESTRA_')) {
            return $this->result('unverified', 'campaign_commercial_review');
        }
        if (in_array($seller, ['0', '57', '74827', '71283'], true)) {
            return $this->result('waiting_assignment', 'campaign_waiting_for_seller');
        }
        if (! $this->id($seller)) {
            return $this->result('unverified', 'campaign_seller_unverified');
        }

        return $this->result('assigned', 'campaign_seller_verified', [
            'ID' => $dealId, 'CONTACT_ID' => $contact, 'LEAD_ID' => $lead === '0' ? '' : $lead, 'ASSIGNED_BY_ID' => $seller,
            'CATEGORY_ID' => '1', 'STAGE_ID' => $stage, 'STAGE_SEMANTIC_ID' => 'P',
            'consent_activity_id' => (string) $send['ID'], 'consent_provider_message_id' => (string) $send['ASSOCIATED_ENTITY_ID'],
            'consent_out_message_id' => (string) $outbound['messageId'],
        ]);
    }

    private function noActiveCase(string $contact, string $phone): array
    {
        // A verified contact may exclude a duplicate application; it can never supply a routing target.
        if ($this->list('crm.deal.list', ['=CONTACT_ID' => $contact, '=STAGE_SEMANTIC_ID' => 'P'], ['ID']) !== []
            || $this->list('crm.lead.list', ['=CONTACT_ID' => $contact, '=STATUS_SEMANTIC_ID' => 'P'], ['ID']) !== []) {
            return $this->result('unverified', 'campaign_other_case_present');
        }
        if ($this->phoneIds('CONTACT', $phone) !== [$contact]) {
            return $this->result('unverified', 'campaign_contact_not_unique');
        }
        // Bitrix can retain open leads and their deals before a CONTACT_ID is attached.
        $leadIds = $this->phoneIds('LEAD', $phone);
        if ($leadIds !== [] && ($this->list('crm.lead.list', ['@ID' => $leadIds, '=STATUS_SEMANTIC_ID' => 'P'], ['ID']) !== []
            || $this->list('crm.deal.list', ['@LEAD_ID' => $leadIds, '=STAGE_SEMANTIC_ID' => 'P'], ['ID']) !== [])) {
            return $this->result('unverified', 'campaign_other_case_present');
        }

        return $this->result('no_active_case', 'campaign_contact_without_open_case');
    }

    private function phoneIds(string $type, string $phone): array
    {
        $response = $this->crm->call('crm.duplicate.findbycomm', ['entity_type' => $type, 'type' => 'PHONE', 'values' => [$phone]]);
        $ids = $response[$type] ?? [];
        if (! is_array($response) || ($response !== [] && ! array_key_exists($type, $response))
            || ! is_array($ids) || ! array_is_list($ids) || count($ids) >= 50) {
            throw new RuntimeException('Incomplete campaign identity lookup.');
        }
        foreach ($ids as $id) {
            if (! $this->id($id)) {
                throw new RuntimeException('Invalid campaign identity.');
            }
        }

        return array_values(array_unique(array_map('strval', $ids)));
    }

    private function list(string $method, array $filter, array $select): array
    {
        $rows = $this->crm->call($method, ['filter' => $filter, 'select' => $select]);
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) >= 50) {
            throw new RuntimeException('Incomplete commercial case lookup.');
        }

        return $rows;
    }

    private function result(string $status, string $reason, ?array $case = null): array
    {
        return ['status' => $status, 'reason' => $reason, 'case' => $case];
    }

    private function outgoingActivity(array $outbound, string $phone): array
    {
        // Edna and Bitrix use different message identifiers. Search all entities so another send to the
        // same recipient cannot be hidden by preselecting the deal of the incoming conversation.
        $at = CarbonImmutable::parse($outbound['sentOrReceivedAt'])->utc();
        $lower = $at->subSeconds(3)->startOfSecond();
        $upper = $at->addSeconds(3)->endOfSecond();
        $rows = $this->crm->call('crm.activity.list', [
            'filter' => ['=PROVIDER_ID' => 'CRM_WHATSAPP', '=DIRECTION' => 2,
                '>=CREATED' => $lower->toIso8601String(), '<=CREATED' => $upper->toIso8601String()],
            'select' => ['ID', 'OWNER_TYPE_ID', 'OWNER_ID', 'DIRECTION', 'CREATED', 'PROVIDER_ID', 'PROVIDER_TYPE_ID', 'ASSOCIATED_ENTITY_ID', 'SETTINGS'],
        ]);
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) >= 50) {
            throw new RuntimeException('Incomplete WhatsApp send activity window.');
        }

        $identities = new AttributionJourney;
        $recipientHash = $identities->phoneHash($phone);
        $match = null;
        foreach ($rows as $row) {
            $settings = $row['SETTINGS'] ?? null;
            $message = $settings['ORIGINAL_MESSAGE'] ?? null;
            if (($row['PROVIDER_ID'] ?? '') !== 'CRM_WHATSAPP' || ($row['PROVIDER_TYPE_ID'] ?? '') !== 'WHATSAPP'
                || (string) ($row['DIRECTION'] ?? '') !== '2' || ! is_array($message)
                || empty($message['SENDER_ID']) || empty($settings['ORIGINAL_TEMPLATE_ID'])
                || empty($message['MESSAGE_FROM']) || empty($message['MESSAGE_TO']) || empty($row['CREATED'])) {
                throw new RuntimeException('Incomplete WhatsApp send activity.');
            }
            $destination = (string) $message['MESSAGE_TO'];
            $sameRecipient = preg_replace('/[^0-9]/', '', $destination) === $phone
                || ($recipientHash !== null && $identities->phoneHash($destination) === $recipientHash);
            if ((string) $settings['ORIGINAL_TEMPLATE_ID'] !== (string) $outbound['matcherId'] || $message['SENDER_ID'] !== 'ednaru'
                || (string) $message['MESSAGE_FROM'] !== (string) $outbound['subjectId']
                || ! $sameRecipient) {
                continue;
            }
            if ($match !== null || ! $this->id($row['ID'] ?? null) || ! $this->id($message['ID'] ?? null)
                || (string) ($row['ASSOCIATED_ENTITY_ID'] ?? '') !== (string) $message['ID']
                || abs($at->diffInSeconds(CarbonImmutable::parse($row['CREATED']), false)) > 3) {
                return ['status' => 'conflict'];
            }
            $match = $row;
        }

        return $match === null ? ['status' => 'absent'] : ['status' => 'matched', 'row' => $match];
    }

    private function id(mixed $value): bool
    {
        return (is_string($value) || is_int($value)) && preg_match('/^[1-9][0-9]{0,18}$/D', (string) $value) === 1;
    }
}
