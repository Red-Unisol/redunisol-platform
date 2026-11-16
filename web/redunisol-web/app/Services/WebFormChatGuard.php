<?php

namespace App\Services;

use DateTimeImmutable;
use DateTimeInterface;
use RuntimeException;
use Throwable;

/** Reads live attention without accepting, transferring or changing a conversation. */
class WebFormChatGuard
{
    private EdnaBitrix $crm;

    private int $calls = 0;

    private float $deadline;

    public function __construct(?EdnaBitrix $crm = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
    }

    /**
     * The returned dialog is for internal use: it contains the connector identity.
     * Bitrix has no expected-owner/session CAS; the caller must inspect again just
     * before its single transfer and reconcile an uncertain POST without replaying it.
     */
    public function inspect(array $proof, string $sellerId): array
    {
        $this->calls = 0;
        $this->deadline = microtime(true) + 30;
        $dialog = null;
        $owner = 0;
        $sessionId = 0;

        try {
            $chatId = $this->id($proof['chat_id'] ?? null);
            $expectedSession = $this->id($proof['session_id'] ?? null);
            $seller = $this->id($sellerId);
            if (! $chatId || ! $expectedSession || ! $seller
                || ($proof['verified'] ?? null) !== true
                || ($proof['source'] ?? '') !== 'bitrix_openline_session'
                || ($proof['evidence'] ?? '') !== 'external_message_id') {
                return $this->result('waiting', 'invalid_native_proof', $owner, $sessionId, $dialog);
            }

            $dialog = $this->call('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
            [$owner, $sessionId, $epoch, $enabled] = $this->dialog($dialog, $chatId);
            if (! $enabled || $sessionId === 0) {
                return $this->result('closed', 'session_closed', $owner, $sessionId, $dialog);
            }
            if ($sessionId !== $expectedSession) {
                return $this->result('replaced', 'session_replaced', $owner, $sessionId, $dialog);
            }
            if ($owner === $seller) {
                return $this->result('already_assigned', 'seller_already_owns_chat', $owner, $sessionId, $dialog);
            }

            $config = $this->call('imopenlines.config.get', ['CONFIG_ID' => 1, 'WITH_QUEUE' => 'Y']);
            if (! is_array($config) || $this->id($config['ID'] ?? null) !== 1 || ! is_array($config['QUEUE'] ?? null)) {
                throw new RuntimeException('Sales queue is unavailable.');
            }
            $allowed = [0, 57]; // Maru was the original receiver before Nico replaced her.
            foreach ($config['QUEUE'] as $entry) {
                if (is_array($entry)) {
                    if (($entry['ENTITY_TYPE'] ?? '') !== 'user') {
                        continue;
                    }
                    $entry = $entry['ENTITY_ID'] ?? null;
                }
                $id = $this->id($entry);
                if (! $id) {
                    throw new RuntimeException('Invalid sales queue.');
                }
                $allowed[] = $id;
            }
            if (! in_array($owner, $allowed, true)) {
                return $this->result('preserved', 'chat_owner_preserved', $owner, $sessionId, $dialog);
            }

            $session = $this->session($chatId, $sessionId, $epoch);
            if ($reason = $this->attention($session, $allowed)) {
                return $this->result('preserved', $reason, $owner, $sessionId, $dialog);
            }
            $stats = $this->call('imopenlines.v2.Session.Stat.get', ['sessionId' => [$sessionId]]);
            $rows = $stats['sessions'] ?? null;
            if (! is_array($rows) || ! array_is_list($rows) || count($rows) !== 1
                || $this->id($rows[0]['sessionId'] ?? null) !== $sessionId) {
                throw new RuntimeException('Session statistics are incomplete.');
            }
            $operatorMessages = $this->count($rows[0]['messagesOperatorCount'] ?? null);
            $transfers = $this->count($rows[0]['transfersCount'] ?? null);
            if ($operatorMessages > 0) {
                return $this->result('preserved', 'operator_message_preserved', $owner, $sessionId, $dialog);
            }
            if ($reason = $this->transfers($sessionId, $transfers)) {
                return $this->result('preserved', $reason, $owner, $sessionId, $dialog);
            }

            // Accepting a chat or transferring it to the same queue operator does
            // not necessarily change dialog.owner. Recheck these records too.
            $session = $this->session($chatId, $sessionId, $epoch);
            if ($reason = $this->attention($session, $allowed)) {
                return $this->result('preserved', $reason, $owner, $sessionId, $dialog);
            }
            if ($reason = $this->transfers($sessionId, $transfers)) {
                return $this->result('preserved', $reason, $owner, $sessionId, $dialog);
            }
            $lastDialog = $this->call('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
            [$lastOwner, $lastSession, , $lastEnabled] = $this->dialog($lastDialog, $chatId);
            if (! $lastEnabled || $lastSession === 0) {
                return $this->result('closed', 'session_closed_during_inspection', $lastOwner, $lastSession, $lastDialog);
            }
            if ($lastSession !== $sessionId) {
                return $this->result('replaced', 'session_replaced_during_inspection', $lastOwner, $lastSession, $lastDialog);
            }
            if ($lastOwner !== $owner) {
                return $this->result('preserved', 'chat_owner_changed_during_inspection', $lastOwner, $lastSession, $lastDialog);
            }

            return $this->result('ready', 'unattended_sales_session', $lastOwner, $lastSession, $lastDialog);
        } catch (Throwable) {
            // Never retain an HTTP exception: the webhook URL is a credential.
            return $this->result('waiting', 'ownership_inspection_unavailable', $owner, $sessionId, $dialog);
        }
    }

    private function dialog(mixed $dialog, int $chatId): array
    {
        if (! is_array($dialog) || $this->id($dialog['id'] ?? null) !== $chatId
            || ($dialog['entity_type'] ?? '') !== 'LINES') {
            throw new RuntimeException('Invalid sales dialog.');
        }
        $identity = explode('|', (string) ($dialog['entity_id'] ?? ''));
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        if (count($identity) < 4 || $identity[0] !== 'whatsappbyedna' || $identity[1] !== '1'
            || count($parts) < 7 || ! array_key_exists('text_field_enabled', $dialog)) {
            throw new RuntimeException('Sales dialog identity is unavailable.');
        }

        return [$this->count($dialog['owner'] ?? null), $this->count($parts[5]), $this->id($parts[6]),
            in_array($dialog['text_field_enabled'], [true, 'Y', 'y', 1, '1'], true)];
    }

    private function session(int $chatId, int $sessionId, ?int $epoch): array
    {
        if (! $epoch) {
            throw new RuntimeException('Session creation time is unavailable.');
        }
        $start = new DateTimeImmutable('@'.$epoch);
        $data = $this->call('imopenlines.v2.Session.list', [
            'configId' => 1, 'dateCreateFrom' => $start->modify('-2 seconds')->format(DateTimeInterface::ATOM),
            'dateCreateTo' => $start->modify('+2 seconds')->format(DateTimeInterface::ATOM),
            'limit' => 200, 'order' => 'dateCreate', 'orderDirection' => 'asc',
        ]);
        if (! is_array($data) || ($data['hasNextPage'] ?? null) !== false
            || ! is_array($data['sessions'] ?? null) || ! array_is_list($data['sessions'])) {
            throw new RuntimeException('Session window is incomplete.');
        }
        $matches = array_values(array_filter($data['sessions'], fn ($row) => is_array($row)
            && $this->id($row['id'] ?? null) === $sessionId && $this->id($row['chatId'] ?? null) === $chatId
            && $this->id($row['configId'] ?? null) === 1));
        if (count($matches) !== 1) {
            throw new RuntimeException('Exact current session is unavailable.');
        }

        return $matches[0];
    }

    private function attention(array $session, array $allowed): ?string
    {
        if (! array_key_exists('operatorId', $session)) {
            throw new RuntimeException('Session operator is unavailable.');
        }
        foreach (['dateOperatorAnswer', 'dateFirstAnswer', 'dateClose'] as $field) {
            if (! array_key_exists($field, $session)) {
                throw new RuntimeException('Operator attention state is incomplete.');
            }
            if ($session[$field] !== null && $session[$field] !== '') {
                return 'operator_attention_preserved';
            }
        }
        if (($session['status'] ?? '') !== 'new') {
            return 'session_attention_preserved';
        }
        if (($session['operatorId'] ?? null) !== null && ! in_array($this->count($session['operatorId']), $allowed, true)) {
            return 'session_operator_preserved';
        }

        return null;
    }

    private function transfers(int $sessionId, int $expectedCount): ?string
    {
        $data = $this->call('imopenlines.v2.Session.Transfer.list', ['sessionId' => [$sessionId]]);
        $rows = $data['transfers'] ?? null;
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) < $expectedCount
            || ($data['hasNextPage'] ?? false) !== false) {
            throw new RuntimeException('Session transfer history is incomplete.');
        }
        foreach ($rows as $row) {
            if (! is_array($row) || $this->id($row['sessionId'] ?? null) !== $sessionId) {
                throw new RuntimeException('Unexpected session transfer.');
            }
            if (($row['type'] ?? '') === 'USER' || ($row['mode'] ?? '') === 'MANUAL') {
                return 'explicit_transfer_preserved';
            }
            if (($row['type'] ?? '') !== 'QUEUE' || ($row['mode'] ?? '') !== 'AUTO') {
                throw new RuntimeException('Unknown session transfer type.');
            }
        }

        return null;
    }

    private function result(string $status, string $reason, int $owner, int $session, mixed $dialog): array
    {
        return ['status' => $status, 'reason' => $reason, 'owner_id' => $owner, 'session_id' => $session, 'dialog' => $dialog];
    }

    private function id(mixed $value): ?int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $number === false || is_bool($value) ? null : $number;
    }

    private function count(mixed $value): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($number === false || $value === null || is_bool($value)) {
            throw new RuntimeException('Invalid ownership counter.');
        }

        return $number;
    }

    private function call(string $method, array $params): mixed
    {
        if (++$this->calls > 10 || microtime(true) >= $this->deadline
            || ! in_array($method, ['imopenlines.dialog.get', 'imopenlines.config.get', 'imopenlines.v2.Session.list',
                'imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list'], true)) {
            throw new RuntimeException('Ownership inspection budget exceeded.');
        }

        return $this->crm->call($method, $params);
    }
}
