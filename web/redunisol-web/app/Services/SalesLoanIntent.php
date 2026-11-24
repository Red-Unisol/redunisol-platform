<?php

namespace App\Services;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** A literal customer request can start loan intake without any outgoing menu or invented button receipt. */
final class SalesLoanIntent
{
    public static function explicit(array $payload): bool
    {
        $content = $payload['messageContent'] ?? [];

        return ($content['type'] ?? '') === 'TEXT' && is_string($content['text'] ?? null)
            && preg_match('/^\s*quiero solicitar un pr[ée]stamo[.!\s]*$/iuD', $content['text']) === 1;
    }

    public static function verified(object $menu, ?array $payload = null): bool
    {
        if (! config('edna.sales_inbox_enabled') || ! config('edna.intake_crm_enabled')
            || $menu->send_state !== 'not_needed' || $menu->choice !== 'loan' || (int) $menu->entry_event_id !== (int) $menu->choice_event_id
            || $menu->outgoing_message_id || $menu->send_started_at) {
            return false;
        }
        $proof = json_decode($menu->proof ?? '', true);
        if (! is_array($proof) || ! ctype_digit((string) ($proof['direct_loan_contact'] ?? '')) || (int) $proof['direct_loan_contact'] < 1) {
            return false;
        }
        $choice = $proof['choice_proof'] ?? null;
        unset($proof['choice_proof'], $proof['direct_loan_contact']);
        if ($choice !== $proof || ($proof['verified'] ?? false) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || (int) $proof['entry_event_id'] !== (int) $menu->entry_event_id
            || (string) $proof['chat_id'] !== (string) $menu->chat_id || (string) $proof['session_id'] !== (string) $menu->session_id) {
            return false;
        }
        $event = DB::table('edna_incoming_events')->find($menu->entry_event_id);
        if (! $event || $event->subject_id !== $menu->subject_id || $event->subject_id !== (string) config('edna.subject_id')
            || $event->message_id !== (string) $proof['entry_message_id']) {
            return false;
        }
        $payload ??= json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);

        return is_array($payload) && self::explicit($payload) && ($payload['subjectId'] ?? '') === $event->subject_id
            && ($payload['id'] ?? '') === $event->message_id
            && hash_equals(Crypt::decryptString($menu->recipient), (string) ($payload['subscriber']['identifier'] ?? ''));
    }
}
