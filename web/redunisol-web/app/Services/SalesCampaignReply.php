<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** Resume a native sales case after explicit loan intent or a verified affirmative recontact button. */
class SalesCampaignReply
{
    public function __construct(private EdnaBitrix $crm, private EdnaOrganicAttention $attention, private EdnaApi $edna) {}

    /** True reserves the seller handoff. An explicit, contact-only loan returns its verified contact to the intake worker.
     * @return bool|array{loan_contact: string}
     */
    public function reserve(array $payload, array $proof, bool $resumeOnly = false): bool|array
    {
        $content = $payload['messageContent'] ?? [];
        $button = ($content['type'] ?? '') === 'BUTTON'
            && $this->affirmative($content['text'] ?? null) && $this->positive($payload['replyOutMessageId'] ?? null);
        $direct = SalesLoanIntent::explicit($payload);
        if ((! $button && ! $direct) || ($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || (string) ($proof['entry_message_id'] ?? '') !== (string) ($payload['id'] ?? '')
            || ! $this->positive($proof['message_id'] ?? null) || ! $this->positive($proof['entry_event_id'] ?? null)
            || ! is_string($payload['receivedAt'] ?? null) || ! preg_match('/(?:Z|[+-]\d{2}:?\d{2})$/D', $payload['receivedAt'])
            || (string) ($payload['subjectId'] ?? '') !== (string) config('edna.subject_id') || ! $this->positive($proof['activity_id'] ?? null)) {
            return false;
        }
        $received = CarbonImmutable::parse($payload['receivedAt'])->utc();
        $cut = DB::table('sales_inbox_cursors')->where('line_id', 1)->value('starts_at');
        if (! $cut || $received->isFuture() || $received->lt(CarbonImmutable::parse($cut, 'UTC'))) {
            return false;
        }
        if ($resumeOnly && ($received->lte(now()->subDay())
            || ! DB::table('sales_inbox_sessions')->where('session_id', $proof['session_id'])->where('chat_id', $proof['chat_id'])
                ->whereNotNull('campaign')->whereNull('intent')->where('acknowledged', false)->whereNull('native_event_sha256')
                ->whereIn('reason', ['customer_window_expired', 'customer_window_unknown'])->exists())) {
            return false;
        }
        $case = $this->sale($proof, allowContactOnly: $direct);
        if (! $case || $case['opened_at']->lt(CarbonImmutable::parse($cut, 'UTC'))) {
            return false;
        }
        if ($case['deal_id'] === null && $case['waiting_lead'] === null) {
            return $resumeOnly ? false : ['loan_contact' => $case['contact_id']];
        }
        // General recontact consent does not identify the deal. The CRM proof above must also match.
        if ($button && ! $this->verifiedButton($payload)) {
            return false;
        }
        $campaign = ['reason' => $button ? 'verified_recontact_consent' : 'explicit_repeat_loan_request',
            'out_message_id' => $button ? (string) $payload['replyOutMessageId'] : null, 'matcher_id' => $button ? 58749 : null,
            'deal_id' => $case['deal_id'], 'waiting_lead' => $case['waiting_lead'], 'received_at' => $received->toIso8601String(),
            'proof' => array_intersect_key($proof, array_flip(['version', 'verified', 'source', 'evidence',
                'chat_id', 'session_id', 'entry_event_id', 'entry_message_id', 'message_id', 'activity_id', 'native_lead_id']))];

        return DB::transaction(function () use ($proof, $case, $campaign, $resumeOnly) {
            $q = DB::table('sales_inbox_sessions')->where('session_id', $proof['session_id']);
            $q->insertOrIgnore(['session_id' => $proof['session_id'], 'chat_id' => $proof['chat_id'], 'channel' => 'whatsappbyedna',
                'opened_at' => $case['opened_at'], 'state' => 'pending', 'available_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            $r = $q->lockForUpdate()->first();
            if ((string) $r->chat_id !== (string) $proof['chat_id'] || $r->channel !== 'whatsappbyedna') {
                return false;
            }
            $windowEnded = ($r->state === 'expired' && $r->reason === 'customer_window_expired')
                || ($r->state === 'needs_attention' && $r->reason === 'customer_window_unknown');
            if ($resumeOnly && (! $r->campaign || ! $windowEnded)) {
                return false;
            }
            if ($r->campaign) {
                if (! $windowEnded || $r->intent || $r->acknowledged || $r->native_event_sha256) {
                    return true; // Existing or uncertain effect owns this session.
                }
                $old = json_decode($r->campaign, true, flags: JSON_THROW_ON_ERROR);
                if ((int) $proof['message_id'] <= (int) $old['proof']['message_id']
                    || (isset($old['received_at']) && CarbonImmutable::parse($campaign['received_at'])->lt(CarbonImmutable::parse($old['received_at'])))
                    || (string) $proof['entry_message_id'] === (string) $old['proof']['entry_message_id']) {
                    return true; // Idempotent replay of a callback that already ended.
                }
                $sameCase = $old['deal_id'] !== null && $old['deal_id'] === $campaign['deal_id'];
                if ($old['deal_id'] === null && ($anchor = $old['waiting_lead'] ?? null)) {
                    $sameCase = $case['lead_id'] === $anchor['id'] && hash_equals($anchor['source_hash'], $case['source_hash'])
                        && ($anchor['contact'] === null || $case['contact_id'] === $anchor['contact']);
                    $campaign['waiting_lead'] = $anchor;
                }
                if (! $sameCase || CarbonImmutable::parse($campaign['received_at'])->lte(now()->subDay())
                    || $old['reason'] !== $campaign['reason'] || $old['matcher_id'] !== $campaign['matcher_id']
                    || (string) $old['proof']['activity_id'] !== (string) $proof['activity_id']) {
                    return false;
                }
                $previous = $old['superseded'] ?? [];
                unset($old['superseded']);
                $campaign['superseded'] = [...$previous, ['reason' => $r->reason, 'reservation' => $old]];
            }
            if ($r->intent || $r->acknowledged || $r->native_event_sha256 || (! ($r->campaign && $windowEnded)
                && ! in_array($r->state, ['pending', 'waiting', 'waiting_customer'], true)
                && ! ($r->state === 'needs_attention' && in_array($r->reason, ['no_verified_channel_outcome', 'native_message_missing_callback',
                    'callback_received_without_verified_outcome', 'callback_identity_unverified'], true)))) {
                return false;
            }
            $q->update(['campaign' => json_encode($campaign, JSON_THROW_ON_ERROR), 'state' => 'pending',
                'reason' => $campaign['reason'], 'available_at' => now(), 'updated_at' => now()]);

            return true;
        });
    }

    public function decision(object $r, array $latest, array $history = []): array
    {
        $c = json_decode($r->campaign, true, flags: JSON_THROW_ON_ERROR);
        $proof = $c['proof'];
        if ((string) $proof['chat_id'] !== (string) $r->chat_id || (string) $proof['session_id'] !== (string) $r->session_id
            || ((string) $latest['message_id'] !== (string) $proof['message_id'] && ! $this->continuesRequest($proof, $history, $latest))) {
            return ['state' => 'needs_attention', 'reason' => 'commercial_reply_superseded'];
        }
        if (DB::table('web_chat_contexts')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)->exists()
            || DB::table('edna_benefit_chat_routes')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)->exists()) {
            return ['state' => 'preserved', 'reason' => 'web_or_benefits_route_owns_session'];
        }
        $case = $this->sale($proof, anchor: $c['waiting_lead'] ?? null);
        if (! $case || ($c['deal_id'] !== null && $case['deal_id'] !== $c['deal_id'])) {
            return ['state' => 'needs_attention', 'reason' => 'commercial_deal_changed'];
        }
        if ($case['deal_id'] === null) {
            return ['state' => 'waiting', 'reason' => 'commercial_deal_pending'];
        }
        if ($c['deal_id'] === null) {
            // A later replacement deal must never inherit this consent once the original conversion was seen.
            $c['deal_id'] = $case['deal_id'];
            $saved = json_encode($c, JSON_THROW_ON_ERROR);
            DB::transaction(function () use ($r, $saved) {
                $q = DB::table('sales_inbox_sessions')->where('session_id', $r->session_id)->where('chat_id', $r->chat_id);
                $stored = $q->lockForUpdate()->first();
                if (! $stored || $stored->intent || ! $stored->campaign || json_decode($stored->campaign, true, flags: JSON_THROW_ON_ERROR)
                    !== json_decode($r->campaign, true, flags: JSON_THROW_ON_ERROR)) {
                    throw new RuntimeException('Commercial reservation changed.');
                }
                $q->update(['campaign' => $saved, 'updated_at' => now()]);
            });
            $r->campaign = $saved;
        }
        if ($case['review']) {
            return ['state' => 'needs_attention', 'reason' => 'commercial_management_requires_review'];
        }
        if (! $case['ready']) {
            return ['state' => 'waiting', 'reason' => 'commercial_seller_pending'];
        }

        return ['action' => 'transfer', 'target_id' => $case['seller_id'], 'deal_id' => $case['deal_id'],
            'reason' => $c['reason'], 'message_id' => $latest['message_id']];
    }

    /** An unanswered request remains open after a plain acknowledgement. A new or unknown intent supersedes it. */
    private function continuesRequest(array $proof, array $history, array $latest): bool
    {
        if (($latest['reason'] ?? '') !== 'customer_request' || (int) ($history['sessionId'] ?? 0) !== (int) $proof['session_id']
            || (int) ($history['chatId'] ?? 0) !== (int) $proof['chat_id'] || ($history['hasNextPage'] ?? null) !== false
            || ! is_array($history['message'] ?? null) || ! is_array($history['users'] ?? null)) {
            return false;
        }
        $original = (int) $proof['message_id'];
        $found = false;
        $last = 0;
        foreach ($history['message'] as $message) {
            $id = (int) $message['id'];
            if ($id < $original || (int) $message['senderid'] === 0) {
                continue;
            }
            if (($history['users'][(int) $message['senderid']]['connector'] ?? null) !== true) {
                return false;
            }
            $params = $message['params'] ?? [];
            $params = is_string($params) ? json_decode($params, true) : $params;
            $mids = $params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? null;
            if (! is_array($params) || ! is_array($mids) || count($mids) !== 1 || ! $this->positive($mids[0] ?? null)) {
                return false;
            }
            if ($id === $original) {
                if ($found || (string) $mids[0] !== (string) $proof['entry_message_id']) {
                    return false;
                }
                $found = true;
            } elseif (! empty($message['files']) || ! empty($message['attachments'])
                || collect($params)->contains(fn ($v, $k) => $v && preg_match('/file|attach|keyboard|reply|quote|forward|sticker|audio/i', (string) $k))
                || ! is_string($message['text'] ?? null)
                || ! preg_match('/^\s*[¡!¿?]*(?:hola|buen(?:os días| día)|gracias|muchas gracias|sigo esperando|quiero solicitar un pr[ée]stamo)[.!¡¿?\s]*$/iuD', $message['text'])) {
                return false;
            }
            $last = max($last, $id);
        }

        return $found && $last === (int) $latest['message_id'] && $last > $original;
    }

    /** Narrow fallback when the callback is absent: one explicit request and a DEAL-owned native activity.
     * A button label alone cannot prove which campaign sent it.
     */
    public function directNative(object $r, array $history, array $latest): ?array
    {
        $incoming = array_values(array_filter($history['message'], fn ($m) => ($history['users'][(int) $m['senderid']]['connector'] ?? null) === true));
        if (count($incoming) !== 1 || ! is_string($incoming[0]['text'] ?? null)
            || ! preg_match('/^\s*quiero solicitar un pr[ée]stamo[.!\s]*$/iuD', $incoming[0]['text'])) {
            return null;
        }
        $params = $incoming[0]['params'] ?? [];
        $params = is_string($params) ? json_decode($params, true) : $params;
        $mids = $params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? null;
        if (! is_array($mids) || count($mids) !== 1 || ! $this->positive($mids[0] ?? null)
            || DB::table('edna_incoming_events')->where('subject_id', (string) config('edna.subject_id'))->where('message_id', (string) $mids[0])->exists()
            || DB::table('edna_organic_menus')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)->exists()
            || DB::table('edna_intake_bindings')->where('native_session_id', $r->session_id)->exists()
            || DB::table('web_chat_contexts')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)->exists()
            || DB::table('edna_benefit_chat_routes')->where('chat_id', $r->chat_id)->where('session_id', $r->session_id)->exists()) {
            return null;
        }
        $d = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $r->chat_id]);
        $tuple = explode('|', (string) ($d['entity_data_1'] ?? ''));
        $source = (string) ($d['entity_id'] ?? '');
        $subject = (string) config('edna.subject_id');
        if ((int) ($d['id'] ?? 0) !== (int) $r->chat_id || ($d['entity_type'] ?? '') !== 'LINES' || ! ctype_digit($subject)
            || ! preg_match('/^whatsappbyedna\|1\|[0-9]{10,15}@'.preg_quote($subject, '/').'\|[0-9]+$/D', $source)
            || count($tuple) < 7 || $tuple[1] !== 'DEAL' || ! $this->positive($tuple[2]) || ! $this->positive($tuple[6])
            || $tuple[5] !== (string) $r->session_id || empty(config('app.key'))) {
            return null;
        }
        $bound = explode('|', rtrim((string) ($d['entity_data_2'] ?? ''), '|'));
        if (count($bound) % 2 !== 0) {
            return null;
        }
        $bindings = [];
        for ($i = 0; $i < count($bound); $i += 2) {
            if ($this->positive($bound[$i + 1])) {
                if (isset($bindings[strtolower($bound[$i])])) {
                    return null;
                }
                $bindings[strtolower($bound[$i])] = $bound[$i + 1];
            }
        }
        if (($bindings['deal'] ?? '') !== $tuple[2]) {
            return null;
        }
        $activities = $this->crm->call('crm.activity.list', ['filter' => ['=PROVIDER_ID' => 'IMOPENLINES_SESSION',
            '=ASSOCIATED_ENTITY_ID' => (int) $r->session_id, '=OWNER_TYPE_ID' => 2, '=OWNER_ID' => (int) $tuple[2]], 'select' => ['ID']]);
        if (! is_array($activities) || count($activities) !== 1 || ! $this->positive($activities[0]['ID'] ?? null)) {
            return null;
        }
        $case = $this->sale(['session_id' => $r->session_id, 'chat_id' => $r->chat_id, 'activity_id' => $activities[0]['ID']],
            ['chat_id' => (string) $r->chat_id, 'session_id' => (string) $r->session_id, 'session_epoch' => $tuple[6], 'bindings' => $bindings,
                'primary_entity' => 'deal', 'primary_id' => $tuple[2], 'source_hash' => hash_hmac('sha256', 'organic-source:'.$source, (string) config('app.key'))]);
        if (! $case) {
            return null;
        }
        if ($case['review']) {
            return ['state' => 'needs_attention', 'reason' => 'commercial_management_requires_review'];
        }
        if (! $case['ready']) {
            return ['state' => 'waiting', 'reason' => 'commercial_seller_pending'];
        }

        return ['action' => 'transfer', 'reason' => 'native_repeat_loan_request', 'message_id' => $latest['message_id'],
            'deal_id' => $case['deal_id'], 'target_id' => $case['seller_id']];
    }

    private function sale(array $proof, ?array $t = null, bool $allowContactOnly = false, ?array $anchor = null): ?array
    {
        // Bitrix may replace the native LEAD binding with its converted DEAL. Verify that edge below.
        $liveProof = $proof;
        if ($anchor !== null) {
            unset($liveProof['native_lead_id']);
        }
        $t ??= $this->attention->snapshot($liveProof)['dialog_tuple'];
        if ((string) $proof['chat_id'] !== $t['chat_id'] || (string) $proof['session_id'] !== $t['session_id']) {
            throw new RuntimeException('Native proof changed.');
        }
        $contact = $t['bindings']['contact'] ?? ($t['primary_entity'] === 'contact' ? $t['primary_id'] : null);
        $bound = $t['bindings']['deal'] ?? ($t['primary_entity'] === 'deal' ? $t['primary_id'] : null);
        $lead = $t['bindings']['lead'] ?? ($t['primary_entity'] === 'lead' ? $t['primary_id'] : null);
        if ($anchor !== null) {
            if (! $this->positive($anchor['id'] ?? null) || ($lead && $lead !== $anchor['id']) || (! $lead && ! $bound)
                || ($anchor['contact'] !== null && $contact !== null && $contact !== $anchor['contact'])
                || ! hash_equals($anchor['source_hash'], $t['source_hash'])) {
                return null;
            }
            $lead = $anchor['id'];
            $contact ??= $anchor['contact'];
        }
        if (! $bound && ! $lead && ! $contact) {
            return null;
        }
        // A contact-scoped continuation must be unique across all open pipelines, including Benefits.
        $filter = $contact ? ['=CONTACT_ID' => $contact] : ($lead ? ['=LEAD_ID' => $lead] : ['=ID' => $bound]);
        $rows = $this->crm->call('crm.deal.list', ['filter' => $filter + ['=STAGE_SEMANTIC_ID' => 'P'],
            'select' => ['ID', 'CONTACT_ID', 'LEAD_ID', 'CATEGORY_ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID']]);
        if (! is_array($rows) || ! array_is_list($rows)) {
            throw new RuntimeException('Invalid commercial case response.');
        }
        $contactOnly = $allowContactOnly && $rows === [] && ! $bound && ! $lead && empty($proof['native_lead_id']) && $contact
            && $t['primary_entity'] === 'contact' && (string) $t['primary_id'] === (string) $contact;
        $leadOnly = $rows === [] && ! $bound && $this->positive($lead)
            && (string) ($proof['native_lead_id'] ?? $lead) === (string) $lead;
        if (! $contactOnly && ! $leadOnly && count($rows) !== 1) {
            return null;
        }
        $d = $rows[0] ?? [];
        if ($rows && ((string) ($d['CATEGORY_ID'] ?? '') !== '1' || ($d['STAGE_SEMANTIC_ID'] ?? '') !== 'P'
            || ! is_string($d['STAGE_ID'] ?? null) || ! str_starts_with($d['STAGE_ID'], 'C1:')
            || ! $this->positive($d['ID'] ?? null) || ($bound && (string) $d['ID'] !== $bound)
            || ($lead && (string) ($d['LEAD_ID'] ?? '') !== $lead) || ($contact && (string) ($d['CONTACT_ID'] ?? '') !== $contact))) {
            return null;
        }
        $activity = $this->crm->call('crm.activity.get', ['id' => (int) $proof['activity_id']]);
        $params = $activity['PROVIDER_PARAMS'] ?? [];
        $params = is_string($params) ? json_decode($params, true) : $params;
        $owner = ['1' => $lead, '2' => $bound, '3' => $contact][(string) ($activity['OWNER_TYPE_ID'] ?? '')] ?? null;
        if (($leadOnly && (string) ($activity['OWNER_TYPE_ID'] ?? '') !== '1') || ! $owner
            || (string) ($activity['OWNER_ID'] ?? '') !== $owner || (string) ($activity['ID'] ?? '') !== (string) $proof['activity_id']
            || ($activity['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION' || (string) ($activity['ASSOCIATED_ENTITY_ID'] ?? '') !== $t['session_id']
            || ! is_string($params['USER_CODE'] ?? null) || ! hash_equals($t['source_hash'], hash_hmac('sha256', 'organic-source:'.$params['USER_CODE'], (string) config('app.key')))) {
            return null;
        }

        $stage = $d['STAGE_ID'] ?? null;
        $review = in_array($stage, [EdnaOrganicMenu::RESPONSE_STAGE, ...WebFormChatRouting::COMMERCIAL_REVIEW_STAGES], true);
        $seller = (int) ($d['ASSIGNED_BY_ID'] ?? 0);

        return ['deal_id' => $rows ? (int) $d['ID'] : null, 'contact_id' => $contact ?? (isset($d['CONTACT_ID']) ? (string) $d['CONTACT_ID'] : null),
            'lead_id' => $lead ?? (isset($d['LEAD_ID']) ? (string) $d['LEAD_ID'] : null), 'source_hash' => $t['source_hash'],
            'seller_id' => $seller, 'review' => $review,
            'ready' => $rows && ! $review && ! in_array($stage, ['C1:KESTRA_PENDING', 'C1:KESTRA_QUEUE'], true)
                && $seller > 0 && ! in_array($seller, [57, 74827, 71283], true),
            'waiting_lead' => $leadOnly ? ['id' => $lead, 'contact' => $contact, 'source_hash' => $t['source_hash']] : null,
            'opened_at' => CarbonImmutable::createFromTimestampUTC((int) $t['session_epoch'])];
    }

    private function verifiedButton(array $payload): bool
    {
        $at = CarbonImmutable::parse($payload['receivedAt']);
        $phone = $payload['subscriber']['identifier'];
        $response = $this->edna->post('messages/history', ['subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
            'subjectId' => (int) $payload['subjectId'], 'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'],
            'dateFrom' => $at->subDays(7)->toIso8601String(), 'dateTo' => $at->toIso8601String(), 'limit' => 1000, 'offset' => 0,
            'sort' => [['property' => 'messageId', 'direction' => 'DESC']]]);
        if ($response->status() !== 200 || $response->json('hasNext') !== false || ! is_array($response->json('content'))) {
            throw new RuntimeException('Incomplete Edna campaign history.');
        }
        $matches = array_values(array_filter($response->json('content'), fn ($m) => (string) ($m['messageId'] ?? '') === (string) $payload['replyOutMessageId']));
        if (count($matches) !== 1) {
            return false;
        }
        $m = $matches[0];
        if ((string) ($m['matcherId'] ?? '') !== '58749' || ($m['matcherName'] ?? '') !== 'reingreso_consent'
            || ($m['direction'] ?? '') !== 'OUT' || ($m['channelType'] ?? '') !== 'WHATSAPP' || ($m['address'] ?? null) !== $phone
            || (string) ($m['subjectId'] ?? '') !== (string) $payload['subjectId'] || (string) ($m['cascadeId'] ?? '') !== (string) config('edna.cascade_id')
            || ! in_array($m['deliveryStatus'] ?? '', ['DELIVERED', 'READ'], true) || empty($m['sentOrReceivedAt'])
            || ! CarbonImmutable::parse($m['sentOrReceivedAt'])->betweenIncluded($at->subDays(7), $at)) {
            return false;
        }
        $content = $m['content'] ?? null;
        $content = is_string($content) ? json_decode($content, true) : $content;
        foreach ($content['keyboard']['rows'] ?? [] as $row) {
            foreach ($row['buttons'] ?? [] as $button) {
                if (is_string($button['payload'] ?? null) && ($button['text'] ?? null) === $payload['messageContent']['text']
                    && $button['payload'] === ($payload['messageContent']['payload'] ?? null)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function affirmative(mixed $text): bool
    {
        return is_string($text) && preg_match('/^\s*s[ií],?\s+quiero asesoramiento[.!\s]*$/iuD', $text) === 1;
    }

    private function positive(mixed $id): bool
    {
        return (is_string($id) || is_int($id)) && preg_match('/^[1-9][0-9]{0,19}$/D', (string) $id) === 1;
    }
}
