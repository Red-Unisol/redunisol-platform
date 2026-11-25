<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

/** Join Bitrix's outgoing template activity and the exact inbound Open Lines activity on their deal. */
class EdnaConsentCase
{
    private const TEMPLATE_ID = '58478';

    public function __construct(private EdnaBitrix $crm, private EdnaOrganicAttention $attention) {}

    /** $outbound is the provider receipt verified for this specific button and recipient. */
    public function resolve(array $proof, array $payload, array $outbound): ?array
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || ! $this->id($proof['entry_message_id'] ?? null)
            || (string) $proof['entry_message_id'] !== (string) ($payload['id'] ?? '')
            || ! $this->id($proof['activity_id'] ?? null) || ! $this->id($proof['message_id'] ?? null)
            || ! $this->id($proof['session_id'] ?? null) || ! $this->id($proof['chat_id'] ?? null)
            || ! $this->id($outbound['messageId'] ?? null)
            || (string) $outbound['messageId'] !== (string) ($payload['replyOutMessageId'] ?? '')
            || ($outbound['uniqueAroundSend'] ?? null) !== true || (string) ($outbound['matcherId'] ?? '') !== self::TEMPLATE_ID
            || (string) ($outbound['subjectId'] ?? '') !== (string) config('edna.subject_id')
            || (string) ($payload['subjectId'] ?? '') !== (string) $outbound['subjectId']) {
            return null;
        }

        $phone = $payload['subscriber']['identifier'] ?? null;
        if (! is_string($phone) || ! preg_match('/^\+?[0-9]{10,15}$/D', $phone)) {
            return null;
        }
        $phone = ltrim($phone, '+');
        $send = $this->outgoingActivity($outbound, $phone);
        if ($send === null || (string) ($send['OWNER_TYPE_ID'] ?? '') !== '2' || ! $this->id($send['OWNER_ID'] ?? null)) {
            return null;
        }
        $dealId = (string) $send['OWNER_ID'];
        $tuple = $this->attention->snapshot($proof)['dialog_tuple'];
        $bound = $tuple['bindings']['deal'] ?? ($tuple['primary_entity'] === 'deal' ? $tuple['primary_id'] : null);
        if ($dealId !== $bound || (string) $proof['chat_id'] !== $tuple['chat_id'] || (string) $proof['session_id'] !== $tuple['session_id']) {
            return null;
        }

        $incoming = $this->crm->call('crm.activity.get', ['id' => $proof['activity_id']]);
        $params = $incoming['PROVIDER_PARAMS'] ?? null;
        $params = is_string($params) ? json_decode($params, true, 16, JSON_THROW_ON_ERROR) : $params;
        $code = $params['USER_CODE'] ?? null;
        $source = is_string($code) ? explode('|', $code) : [];
        if ((string) ($incoming['ID'] ?? '') !== (string) $proof['activity_id']
            || ($incoming['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
            || (string) ($incoming['ASSOCIATED_ENTITY_ID'] ?? '') !== $tuple['session_id']
            || (string) ($incoming['OWNER_TYPE_ID'] ?? '') !== '2' || (string) ($incoming['OWNER_ID'] ?? '') !== $dealId
            || count($source) !== 4 || $source[0] !== 'whatsappbyedna' || $source[1] !== '1'
            || $source[2] !== $phone.'@'.$outbound['subjectId']
            || ! hash_equals($tuple['source_hash'], hash_hmac('sha256', 'organic-source:'.$code, (string) config('app.key')))) {
            return null;
        }

        $deal = $this->crm->call('crm.deal.get', ['id' => $dealId]);
        $contact = (string) ($deal['CONTACT_ID'] ?? '');
        $lead = (string) ($deal['LEAD_ID'] ?? '');
        $seller = (string) ($deal['ASSIGNED_BY_ID'] ?? '');
        $stage = (string) ($deal['STAGE_ID'] ?? '');
        if ((string) ($deal['ID'] ?? '') !== $dealId || ! $this->id($contact)
            || (isset($tuple['bindings']['contact']) && $tuple['bindings']['contact'] !== $contact)
            || (isset($tuple['bindings']['lead']) && $tuple['bindings']['lead'] !== $lead)
            || (string) ($deal['CATEGORY_ID'] ?? '') !== '1' || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P'
            || ($deal['CLOSED'] ?? '') !== 'N' || ! str_starts_with($stage, 'C1:') || str_starts_with($stage, 'C1:KESTRA_')
            || ! $this->id($seller) || in_array($seller, ['57', '74827', '71283'], true)) {
            return null;
        }

        // A contact with concurrent opportunities requires an unambiguous commercial scope, including Benefits.
        $open = $this->crm->call('crm.deal.list', ['filter' => ['=CONTACT_ID' => $contact, '=STAGE_SEMANTIC_ID' => 'P'],
            'select' => ['ID', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'ASSIGNED_BY_ID']]);
        if (! is_array($open) || ! array_is_list($open)) {
            throw new RuntimeException('Invalid open deal lookup.');
        }
        if (count($open) !== 1 || (string) ($open[0]['ID'] ?? '') !== $dealId
            || (string) ($open[0]['CONTACT_ID'] ?? '') !== $contact || (string) ($open[0]['CATEGORY_ID'] ?? '') !== '1'
            || ($open[0]['STAGE_ID'] ?? '') !== $stage || (string) ($open[0]['ASSIGNED_BY_ID'] ?? '') !== $seller) {
            return null;
        }

        return [
            'ID' => $dealId, 'CONTACT_ID' => $contact, 'LEAD_ID' => $lead === '0' ? '' : $lead, 'ASSIGNED_BY_ID' => $seller,
            'CATEGORY_ID' => '1', 'STAGE_ID' => $stage, 'STAGE_SEMANTIC_ID' => 'P',
            'consent_activity_id' => (string) $send['ID'], 'consent_provider_message_id' => (string) $send['ASSOCIATED_ENTITY_ID'],
            'consent_out_message_id' => (string) $outbound['messageId'],
        ];
    }

    private function outgoingActivity(array $outbound, string $phone): ?array
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
            if ((string) $settings['ORIGINAL_TEMPLATE_ID'] !== self::TEMPLATE_ID || $message['SENDER_ID'] !== 'ednaru'
                || (string) $message['MESSAGE_FROM'] !== (string) $outbound['subjectId']
                || ! $sameRecipient) {
                continue;
            }
            if ($match !== null || ! $this->id($row['ID'] ?? null) || ! $this->id($message['ID'] ?? null)
                || (string) ($row['ASSOCIATED_ENTITY_ID'] ?? '') !== (string) $message['ID']
                || abs($at->diffInSeconds(CarbonImmutable::parse($row['CREATED']), false)) > 3) {
                return null;
            }
            $match = $row;
        }

        return $match;
    }

    private function id(mixed $value): bool
    {
        return (is_string($value) || is_int($value)) && preg_match('/^[1-9][0-9]{0,18}$/D', (string) $value) === 1;
    }
}
