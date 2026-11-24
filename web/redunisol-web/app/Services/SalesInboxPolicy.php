<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

final class SalesInboxPolicy
{
    public const CHANNELS = ['whatsappbyedna', 'facebook', 'facebookcomments', 'fbinstagramdirect'];

    /** Explicit, whole-message intent only. Qualifiers, links, questions and attachments are not courtesy. */
    public static function terminalText(mixed $text): bool
    {
        if (! is_string($text) || strlen($text) > 100) {
            return false;
        }

        return preg_match('/^\s*[¡!]*(?:muchas gracias|gracias|no gracias|no, gracias|no me interesa|muchas gracias por la información)[.!¡\s]*$/iuD', $text) === 1;
    }

    public static function plainTerminalMessage(array $message): bool
    {
        $params = $message['params'] ?? [];
        $params = is_string($params) ? json_decode($params, true) : $params;
        if (! is_array($params) || ! empty($message['files']) || ! empty($message['attachments'])) {
            return false;
        }
        foreach ($params as $key => $value) {
            if ($value && preg_match('/file|attach|keyboard|reply|quote|forward|sticker|audio/i', (string) $key)) {
                return false;
            }
        }

        return self::terminalText($message['text'] ?? null);
    }

    /** Only ids and a decision leave the reader. A "gracias" appended to an unanswered request cannot close it. */
    public function conversation(array $history, object $session): array
    {
        if ((int) ($history['sessionId'] ?? 0) !== (int) $session->session_id
            || (int) ($history['chatId'] ?? 0) !== (int) $session->chat_id
            || ($history['hasNextPage'] ?? null) !== false || ($history['tariffRestrictions']['isHistoryLimitExceeded'] ?? false) !== false
            || ! is_array($history['message'] ?? null) || ! is_array($history['users'] ?? null)) {
            throw new RuntimeException('Incomplete sales session history.');
        }
        $last = 0;
        $lastDate = null;
        $newestTimestamp = PHP_INT_MIN;
        $seen = [];
        $allTerminal = true;
        foreach ($history['message'] as $message) {
            if (! is_array($message) || (int) ($message['chatid'] ?? 0) !== (int) $session->chat_id
                || ! ctype_digit((string) ($message['senderid'] ?? '')) || (int) ($message['id'] ?? 0) < 1) {
                throw new RuntimeException('Invalid sales session message.');
            }
            $id = (int) $message['id'];
            if (isset($seen[$id])) {
                throw new RuntimeException('Duplicate native message ID.');
            }
            $seen[$id] = true;
            $sender = (int) $message['senderid'];
            if ($sender === 0) {
                // Open Lines uses reserved sender 0 for service events.
                $params = $message['params'] ?? [];
                $params = is_string($params) ? json_decode($params, true) : $params;
                if (! is_array($params) || ! empty($params['connectorMid']) || ! empty($params['CONNECTOR_MID'])
                    || ! in_array($message['system'] ?? null, [null, true], true)
                    || str_contains(json_encode($params['class'] ?? ''), 'bx-messenger-content-item-ol-output')) {
                    throw new RuntimeException('Unclassified session service event.');
                }

                continue;
            }
            $connector = $history['users'][$sender]['connector'] ?? null;
            if ($connector === false) {
                return ['reason' => 'operator_message_preserved', 'message_id' => 0];
            }
            if ($connector !== true) {
                throw new RuntimeException('Unclassified session participant.');
            }
            if (! is_string($message['date'] ?? null) || ! preg_match('/(?:Z|[+-]\d\d:\d\d)$/D', $message['date'])) {
                throw new RuntimeException('Missing incoming message date.');
            }
            $newestTimestamp = max($newestTimestamp, CarbonImmutable::parse($message['date'])->timestamp);
            if ((int) $message['id'] > $last) {
                $last = (int) $message['id'];
                $lastDate = $message['date'];
            }
            $allTerminal = $allTerminal && self::plainTerminalMessage($message);
        }
        if (! $last) {
            return ['reason' => 'inbound_not_visible', 'message_id' => 0];
        }

        if (CarbonImmutable::parse($lastDate)->timestamp !== $newestTimestamp) {
            throw new RuntimeException('Inconsistent native message chronology.');
        }

        return ['reason' => $allTerminal ? 'explicit_terminal_reply' : 'customer_request', 'message_id' => $last, 'last_customer_at' => $lastDate];
    }
}
