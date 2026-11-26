<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class EdnaCampaignReplyOrder
{
    /** Pending callbacks may delay a handoff. Only verified replies for this native session can cancel it. */
    public function decision(array $outbound, array $payload, array $proof): ?string
    {
        $latest = CarbonImmutable::parse($payload['receivedAt']);
        $declined = false;
        $pending = null;
        $rows = DB::table('edna_campaign_reply_inbox as i')
            ->join('edna_incoming_events as e', 'e.id', '=', 'i.entry_event_id')
            ->leftJoin('edna_organic_menus as m', 'm.entry_event_id', '=', 'i.entry_event_id')
            ->leftJoin('edna_organic_menus as canonical', 'canonical.id', '=', 'm.canonical_menu_id')
            ->where('i.subject_id', $outbound['subjectId'])->where('i.outbound_message_id', $outbound['messageId'])
            ->where('i.entry_event_id', '!=', $proof['entry_event_id'])
            ->get(['e.id', 'e.message_id', 'e.status', 'e.payload', 'm.send_state', 'm.form_consent', 'm.campaign_prompt',
                'canonical.form_consent as canonical_consent', 'canonical.campaign_prompt as canonical_prompt']);
        foreach ($rows as $row) {
            $raw = json_decode(Crypt::decryptString($row->payload), true, 32, JSON_THROW_ON_ERROR);
            if (($raw['subscriber']['identifier'] ?? null) !== $payload['subscriber']['identifier'] || (string) $raw['id'] !== (string) $row->message_id
                || (string) ($raw['subjectId'] ?? '') !== (string) $outbound['subjectId'] || (string) ($raw['replyOutMessageId'] ?? '') !== (string) $outbound['messageId']
                || ! app(EdnaCampaignTemplate::class)->candidate($raw)) {
                continue;
            }
            $at = CarbonImmutable::parse($raw['receivedAt']);
            if ($at->lt($latest)) {
                continue;
            }
            $receipt = null;
            foreach ([$row->form_consent, $row->campaign_prompt, $row->canonical_consent, $row->canonical_prompt] as $source) {
                $item = $source === null ? null : json_decode($source, true, 32, JSON_THROW_ON_ERROR);
                if ((string) ($item['entry_event_id'] ?? '') === (string) $row->id) {
                    $receipt = $item;
                    if (isset($item['native_proof'])) {
                        break;
                    }
                }
            }
            if ($receipt === null && $row->status === 'delivered' && $row->send_state !== 'verify_campaign') {
                // The inbox worker already handled this as another route, e.g. an ordinary organic button.
                continue;
            }
            $native = $receipt['native_proof'] ?? [];
            if (! isset($receipt['action'], $receipt['outbound']) || (string) $row->id !== (string) ($receipt['entry_event_id'] ?? '')
                || (string) $row->id !== (string) ($native['entry_event_id'] ?? '') || (string) $row->message_id !== (string) ($native['entry_message_id'] ?? '')
                || ($native['verified'] ?? null) !== true || ($native['source'] ?? '') !== 'bitrix_openline_session'
                || ($native['evidence'] ?? '') !== 'external_message_id' || empty($native['chat_id']) || empty($native['session_id'])) {
                $pending = $pending === null ? $at : $pending->max($at);
                continue;
            }
            if ((string) $native['chat_id'] !== (string) $proof['chat_id'] || (string) $native['session_id'] !== (string) $proof['session_id']) {
                continue;
            }
            foreach (['messageId', 'subjectId', 'matcherId', 'matcherName'] as $field) {
                if (! isset($receipt['outbound'][$field], $outbound[$field]) || (string) $receipt['outbound'][$field] !== (string) $outbound[$field]) {
                    return 'waiting';
                }
            }
            $action = $receipt['action'];
            if (! in_array($action, ['benefits', 'continue', 'offer', 'clarify', 'form_consent', 'defer', 'decline'], true)) {
                continue;
            }
            $negative = in_array($action, ['decline', 'defer'], true) || ($action === 'form_consent' && ($receipt['choice'] ?? '') === 'no');
            if ($at->gt($latest) || $negative) {
                $latest = $at;
                $declined = $negative;
            }
        }
        if ($pending !== null && ($pending->gt($latest) || (! $declined && $pending->equalTo($latest)))) {
            return 'waiting';
        }

        return $declined ? 'declined' : null;
    }
}
