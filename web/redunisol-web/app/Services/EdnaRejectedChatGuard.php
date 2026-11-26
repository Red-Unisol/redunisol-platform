<?php

namespace App\Services;

use DateTimeImmutable;
use DateTimeInterface;
use RuntimeException;
use Throwable;

/** Read-only eligibility for one rejected session; never accepts, transfers or closes. */
class EdnaRejectedChatGuard
{
    private EdnaBitrix $crm;

    private int $calls = 0;

    private float $deadline;

    private const OWNERS = [0, 57, 74827];

    public function __construct(?EdnaBitrix $crm = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
    }

    /**
     * Caller proves rejection, approved template and BP receipt. We recheck the
     * exact native notice and current attention. Returned dialog is INTERNAL and
     * may contain connector PII. Bitrix's closing POST has no session/owner CAS.
     */
    public function inspect(array $proof, array $notice): array
    {
        return $this->inspectSession($proof, $notice, 2);
    }

    /** Refresh every attention source and the dialog around a single final verification. */
    public function refresh(array $proof, array $notice): array
    {
        return $this->inspectSession($proof, $notice, 1);
    }

    private function inspectSession(array $proof, array $notice, int $rounds): array
    {
        $this->calls = 0;
        $this->deadline = microtime(true) + 30;
        $owner = $sessionId = 0;
        $createdAt = null;
        $dialog = null;
        $counts = [];
        try {
            $chatId = $this->id($proof['chat_id'] ?? null);
            $expected = $this->id($proof['session_id'] ?? null);
            if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
                || ($proof['evidence'] ?? '') !== 'external_message_id') {
                throw new RuntimeException('Invalid native proof.');
            }
            $this->validateNotice($notice);
            $dialog = $this->read('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
            [$owner, $sessionId, $epoch, $enabled] = $this->dialog($dialog, $chatId);
            if ($sessionId > 0 && $sessionId !== $expected) {
                return $this->result('replaced', 'session_replaced', $owner, $sessionId, $createdAt, $dialog, $counts);
            }
            if (! $enabled || $sessionId === 0) {
                return $this->result('closed', 'session_closed', $owner, $sessionId, $createdAt, $dialog, $counts);
            }
            if (! in_array($owner, self::OWNERS, true)) {
                return $this->result('preserved', 'chat_owner_preserved', $owner, $sessionId, $createdAt, $dialog, $counts);
            }
            $firstDialog = $dialog;
            // Repeat all attention sources: taking a queue chat need not change
            // owner, and a newly arriving message may precede the dialog reread.
            for ($round = 0; $round < $rounds; $round++) {
                $session = $this->session($chatId, $sessionId, $epoch);
                $createdAt = $session['dateCreate'];
                if ($reason = $this->attention($session)) {
                    $status = $reason === 'session_closed' ? 'closed' : 'preserved';

                    return $this->result($status, $reason, $owner, $sessionId, $createdAt, $dialog, $counts);
                }
                $stats = $this->read('imopenlines.v2.Session.Stat.get', ['sessionId' => [$sessionId]]);
                $rows = $stats['sessions'] ?? null;
                if (! is_array($rows) || ! array_is_list($rows) || count($rows) !== 1
                    || $this->id($rows[0]['sessionId'] ?? null) !== $sessionId) {
                    throw new RuntimeException('Session statistics are incomplete.');
                }
                $counts = ['operator_message_count' => $this->count($rows[0]['messagesOperatorCount'] ?? null),
                    'transfer_count' => $this->count($rows[0]['transfersCount'] ?? null)];
                if ($reason = $this->transfers($sessionId, $counts['transfer_count'])) {
                    return $this->result('preserved', $reason, $owner, $sessionId, $createdAt, $dialog, $counts);
                }
                $history = $this->read('imopenlines.session.history.get', ['SESSION_ID' => $sessionId]);
                if ($reason = $this->history($history, $chatId, $sessionId, $notice)) {
                    return $this->result('preserved', $reason, $owner, $sessionId, $createdAt, $dialog, $counts);
                }
                // The exact known notice may be counted as zero or one operator
                // message by Bitrix. No other outgoing message is exempted.
                if ($counts['operator_message_count'] > 1) {
                    return $this->result('preserved', 'operator_message_preserved', $owner, $sessionId, $createdAt, $dialog, $counts);
                }
            }
            $dialog = $this->read('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
            [$lastOwner, $lastSession, $lastEpoch, $lastEnabled] = $this->dialog($dialog, $chatId);
            if ($lastSession > 0 && $lastSession !== $sessionId) {
                return $this->result('replaced', 'session_replaced_during_inspection', $lastOwner, $lastSession, $createdAt, $dialog, $counts);
            }
            if (! $lastEnabled || $lastSession === 0) {
                return $this->result('closed', 'session_closed_during_inspection', $lastOwner, $lastSession, $createdAt, $dialog, $counts);
            }
            if ($lastOwner !== $owner) {
                return $this->result('preserved', 'chat_owner_changed_during_inspection', $lastOwner, $lastSession, $createdAt, $dialog, $counts);
            }
            if ($lastEpoch !== $epoch || $dialog['entity_id'] !== $firstDialog['entity_id']
                || $dialog['entity_data_2'] !== $firstDialog['entity_data_2']
                || array_slice(explode('|', $dialog['entity_data_1']), 0, 5) !== array_slice(explode('|', $firstDialog['entity_data_1']), 0, 5)) {
                return $this->result('preserved', 'chat_identity_changed_during_inspection', $lastOwner, $lastSession, $createdAt, $dialog, $counts);
            }

            return $this->result('ready', 'rejected_session_unattended', $lastOwner, $lastSession, $createdAt, $dialog, $counts);
        } catch (Throwable) {
            // Never retain provider exceptions or private notice/connector text.
            return $this->result('waiting', 'rejected_session_inspection_unavailable', $owner, $sessionId, $createdAt, $dialog, $counts);
        }
    }

    private function validateNotice(array $notice): void
    {
        $this->id($notice['message_id'] ?? null);
        $this->id($notice['sender_id'] ?? null);
        $this->date($notice['date'] ?? null);
        foreach (['template_sha256', 'native_text_sha256'] as $field) {
            if (! is_string($notice[$field] ?? null) || ! preg_match('/^[a-f0-9]{64}$/D', $notice[$field])) {
                throw new RuntimeException('Invalid notice fingerprint.');
            }
        }
        if (! is_string($notice['connector_mid'] ?? null) || $notice['connector_mid'] === ''
            || strlen($notice['connector_mid']) > 512 || preg_match('/\s|[\x00-\x1f\x7f]/', $notice['connector_mid'])) {
            throw new RuntimeException('Invalid notice connector identifier.');
        }
    }

    private function dialog(mixed $dialog, int $chatId): array
    {
        if (! is_array($dialog) || $this->id($dialog['id'] ?? null) !== $chatId
            || ($dialog['entity_type'] ?? '') !== 'LINES' || ! is_string($dialog['entity_data_1'] ?? null)
            || ! is_string($dialog['entity_data_2'] ?? null) || ! array_key_exists('text_field_enabled', $dialog)) {
            throw new RuntimeException('Invalid sales dialog.');
        }
        $identity = explode('|', (string) ($dialog['entity_id'] ?? ''));
        $parts = explode('|', $dialog['entity_data_1']);
        if (count($identity) !== 4 || $identity[0] !== 'whatsappbyedna' || $identity[1] !== '1' || count($parts) < 7) {
            throw new RuntimeException('Sales channel identity is unavailable.');
        }
        $this->id($identity[3]);
        $enabled = $dialog['text_field_enabled'];
        if (! in_array($enabled, [true, false, 'Y', 'N', 'y', 'n', 1, 0, '1', '0'], true)) {
            throw new RuntimeException('Dialog state is incomplete.');
        }

        return [$this->count($dialog['owner'] ?? null), $this->count($parts[5]), $this->count($parts[6]),
            in_array($enabled, [true, 'Y', 'y', 1, '1'], true)];
    }

    private function session(int $chatId, int $sessionId, int $epoch): array
    {
        if ($epoch === 0) {
            throw new RuntimeException('Session creation time is unavailable.');
        }
        $start = new DateTimeImmutable('@'.$epoch);
        $data = $this->read('imopenlines.v2.Session.list', ['configId' => 1,
            'dateCreateFrom' => $start->modify('-2 seconds')->format(DateTimeInterface::ATOM),
            'dateCreateTo' => $start->modify('+2 seconds')->format(DateTimeInterface::ATOM),
            'limit' => 200, 'order' => 'dateCreate', 'orderDirection' => 'asc']);
        if (! is_array($data) || ($data['hasNextPage'] ?? null) !== false
            || ! is_array($data['sessions'] ?? null) || ! array_is_list($data['sessions'])) {
            throw new RuntimeException('Session window is incomplete.');
        }
        $matches = array_values(array_filter($data['sessions'], fn ($row) => is_array($row)
            && $this->id($row['id'] ?? null) === $sessionId && $this->id($row['chatId'] ?? null) === $chatId
            && $this->id($row['configId'] ?? null) === 1));
        if (count($matches) !== 1 || abs($this->date($matches[0]['dateCreate'] ?? null)->getTimestamp() - $epoch) > 2) {
            throw new RuntimeException('Exact session is unavailable.');
        }

        return $matches[0];
    }

    private function attention(array $session): ?string
    {
        foreach (['operatorId', 'status', 'dateOperatorAnswer', 'dateFirstAnswer', 'dateClose'] as $field) {
            if (! array_key_exists($field, $session)) {
                throw new RuntimeException('Attention state is incomplete.');
            }
        }
        if (! is_string($session['status']) || $session['status'] === '') {
            throw new RuntimeException('Session status is unavailable.');
        }
        if (($session['dateClose'] !== null && $session['dateClose'] !== '') || $session['status'] === 'closed') {
            return 'session_closed';
        }
        if (($session['dateOperatorAnswer'] !== null && $session['dateOperatorAnswer'] !== '')
            || ($session['dateFirstAnswer'] !== null && $session['dateFirstAnswer'] !== '')) {
            return 'operator_attention_preserved';
        }
        if ($session['status'] !== 'new') {
            return 'session_attention_preserved';
        }
        if ($session['operatorId'] !== null && ! in_array($this->count($session['operatorId']), self::OWNERS, true)) {
            return 'session_operator_preserved';
        }

        return null;
    }

    private function transfers(int $sessionId, int $expected): ?string
    {
        $data = $this->read('imopenlines.v2.Session.Transfer.list', ['sessionId' => [$sessionId]]);
        $rows = $data['transfers'] ?? null;
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) < $expected
            || ($data['hasNextPage'] ?? false) !== false) {
            throw new RuntimeException('Transfer history is incomplete.');
        }
        foreach ($rows as $row) {
            if (! is_array($row) || $this->id($row['sessionId'] ?? null) !== $sessionId) {
                throw new RuntimeException('Transfer belongs to another session.');
            }
            if (($row['type'] ?? '') === 'USER' || ($row['mode'] ?? '') === 'MANUAL') {
                return 'explicit_transfer_preserved';
            }
            if (($row['type'] ?? '') !== 'QUEUE' || ($row['mode'] ?? '') !== 'AUTO') {
                throw new RuntimeException('Unknown transfer state.');
            }
        }

        return null;
    }

    private function history(mixed $history, int $chatId, int $sessionId, array $notice): ?string
    {
        if (! is_array($history) || $this->id($history['sessionId'] ?? null) !== $sessionId
            || $this->id($history['chatId'] ?? null) !== $chatId || ($history['hasNextPage'] ?? null) !== false
            || ! is_array($history['message'] ?? null) || ! is_array($history['users'] ?? null)
            || (($history['tariffRestrictions']['isHistoryLimitExceeded'] ?? false) !== false)) {
            throw new RuntimeException('Native history is incomplete.');
        }
        $noticeId = $this->id($notice['message_id']);
        $noticeDate = $this->date($notice['date']);
        $seen = [];
        $noticeFound = false;
        $reason = null;
        foreach ($history['message'] as $message) {
            if (! is_array($message) || $this->id($message['chatid'] ?? null) !== $chatId) {
                throw new RuntimeException('Native message belongs to another chat.');
            }
            $id = $this->id($message['id'] ?? null);
            if (isset($seen[$id])) {
                throw new RuntimeException('Duplicate native message identifier.');
            }
            $seen[$id] = true;
            $sender = $this->count($message['senderid'] ?? null);
            $at = $this->date($message['date'] ?? null);
            $user = $history['users'][(string) $sender] ?? null;
            if ($id === $noticeId) {
                $params = $message['params'] ?? null;
                $params = is_string($params) ? json_decode($params, true) : $params;
                $classes = is_array($params) ? ($params['class'] ?? null) : null;
                $classes = is_string($classes) ? preg_split('/\s+/', $classes) : $classes;
                $mids = is_array($params) ? ($params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? []) : [];
                $mids = is_array($mids) ? $mids : [$mids];
                if ($sender !== $this->count($notice['sender_id']) || $at != $noticeDate
                    || ! is_array($user) || ($user['connector'] ?? null) !== false
                    || ! is_string($message['text'] ?? null)
                    || ! hash_equals($notice['native_text_sha256'], hash('sha256', $message['text']))
                    || ! is_array($classes) || ! in_array('bx-messenger-content-item-ol-output', $classes, true)
                    || count(array_filter($mids, fn ($mid) => is_string($mid) && hash_equals($notice['connector_mid'], $mid))) !== 1) {
                    throw new RuntimeException('Exact native notice is unavailable.');
                }
                $noticeFound = true;

                continue;
            }
            if ($sender === 0) {
                $this->systemMessage($message, $user, array_key_exists(0, $history['users']));

                continue;
            }
            if (! is_array($user) || ! is_bool($user['connector'] ?? null)) {
                throw new RuntimeException('Unclassified native sender.');
            }
            if ($user['connector'] === false) {
                $reason = 'operator_message_preserved';
            } elseif ($at > $noticeDate || $id > $noticeId) {
                $reason = 'client_reply_after_notice_preserved';
            }
        }
        if (! $noticeFound) {
            throw new RuntimeException('Notice is missing from the complete session.');
        }

        return $reason;
    }

    private function systemMessage(array $message, mixed $user, bool $hasUser): void
    {
        // The native session-history response uses reserved sender 0 for its
        // internal events and normally omits both users[0] and a system flag.
        // Never apply this exception to a positive ID, a connector user or an
        // outgoing connector message, even if other metadata calls it system.
        if (($hasUser && (! is_array($user) || ($user['connector'] ?? null) !== false))
            || (array_key_exists('system', $message) && ! in_array($message['system'], [null, true], true))) {
            throw new RuntimeException('Contradictory native system sender.');
        }
        $params = $message['params'] ?? [];
        $params = is_string($params) ? json_decode($params, true) : $params;
        if (! is_array($params)) {
            throw new RuntimeException('Native system parameters are unavailable.');
        }
        foreach (['connectorMid', 'CONNECTOR_MID'] as $field) {
            if (isset($params[$field]) && ! in_array($params[$field], [[], '', null], true)) {
                throw new RuntimeException('System sender has connector message evidence.');
            }
        }
        $classes = $params['class'] ?? [];
        $classes = is_string($classes) ? preg_split('/\s+/', $classes) : $classes;
        if (! is_array($classes) || in_array('bx-messenger-content-item-ol-output', $classes, true)) {
            throw new RuntimeException('System sender has operator output evidence.');
        }
    }

    private function date(mixed $value): DateTimeImmutable
    {
        if (! is_string($value) || ! preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $value)) {
            throw new RuntimeException('Invalid native timestamp.');
        }
        $date = new DateTimeImmutable($value);
        $errors = DateTimeImmutable::getLastErrors();
        if (is_array($errors) && ($errors['warning_count'] || $errors['error_count'])) {
            throw new RuntimeException('Invalid native timestamp.');
        }

        return $date;
    }

    private function id(mixed $value): int
    {
        $number = $this->count($value);
        if ($number === 0) {
            throw new RuntimeException('Invalid positive identifier.');
        }

        return $number;
    }

    private function count(mixed $value): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($number === false || $value === null || is_bool($value)) {
            throw new RuntimeException('Invalid nonnegative counter.');
        }

        return $number;
    }

    private function result(string $status, string $reason, int $owner, int $sessionId, ?string $createdAt, mixed $dialog, array $counts): array
    {
        return ['status' => $status, 'reason' => $reason, 'owner_id' => $owner, 'session_id' => $sessionId,
            'session_created_at' => $createdAt, 'dialog' => $dialog] + $counts;
    }

    private function read(string $method, array $params): mixed
    {
        if (++$this->calls > 10 || microtime(true) >= $this->deadline
            || ! in_array($method, ['imopenlines.dialog.get', 'imopenlines.v2.Session.list',
                'imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list', 'imopenlines.session.history.get'], true)) {
            throw new RuntimeException('Read budget exhausted.');
        }

        return $this->crm->call($method, $params);
    }
}
