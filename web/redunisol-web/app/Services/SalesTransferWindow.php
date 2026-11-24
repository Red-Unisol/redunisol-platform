<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use DateTimeImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/** Read-only. Each verdict describes one native session, not an owner or a transferable CRM case. */
class SalesTransferWindow
{
    private const LOCAL_CUTOVER = 'sales-local-transfer-window-v1';

    /** Existing Laravel routes keep their native checks during deployment. The dedicated verifier always uses inspect(). */
    public static function forLocalTransfer(EdnaBitrix $crm, int $chatId, int $sessionId, ?array $dialog = null, bool $requireWindow = false): array
    {
        $session = ['chat_id' => $chatId, 'session_id' => $sessionId];
        if (SalesChatTransfer::ownsSession($chatId, $sessionId)) {
            return $session + ['state' => 'delivery_pending'];
        }
        if (! $requireWindow && ! self::localWindowActive()) {
            return $session + ['state' => 'legacy'];
        }

        return $session + app(self::class)->inspect($crm, $chatId, $sessionId, $dialog);
    }

    public static function localBlockReason(array $window): ?string
    {
        if ($window['state'] === 'delivery_pending' || SalesChatTransfer::ownsSession($window['chat_id'], $window['session_id'])) {
            return 'kestra_delivery_pending';
        }
        if ($window['state'] === 'legacy') {
            // Another worker may have activated strict proof since the native preflight.
            return self::localWindowActive() ? 'customer_window_unknown' : null;
        }

        return self::blockReason($window);
    }

    private static function localWindowActive(): bool
    {
        $cutovers = DB::table('edna_intake_cutovers');
        if ($cutovers->where('name', self::LOCAL_CUTOVER)->exists()) {
            return true;
        }
        if (config('edna.local_transfer_window_enabled') !== true) {
            return false;
        }
        // Latch the opt-in in the shared database so that older environment settings cannot reopen an expired window.
        $cutovers->insertOrIgnore(['name' => self::LOCAL_CUTOVER, 'entry_id_after' => 0, 'starts_at' => now()]);

        return true;
    }

    public function inspect(EdnaBitrix $crm, int $chatId, int $sessionId, ?array $guardedDialog = null): array
    {
        $result = ['chat_id' => $chatId, 'session_id' => $sessionId, 'state' => 'unknown', 'expires_at' => null];
        try {
            // Local callers hold the chat lease and run the full native attention guard again after this read.
            $dialog = $guardedDialog ?? $crm->call('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
            $identity = explode('|', (string) ($dialog['entity_id'] ?? ''));
            $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
            if ((string) ($dialog['id'] ?? '') !== (string) $chatId || ($dialog['entity_type'] ?? '') !== 'LINES'
                || count($identity) !== 4 || ! in_array($identity[0], SalesInboxPolicy::CHANNELS, true) || $identity[1] !== '1'
                || ! ctype_digit($parts[5] ?? '') || ! array_key_exists('text_field_enabled', $dialog)) {
                return $result;
            }
            if ($parts[5] !== (string) $sessionId || in_array($dialog['text_field_enabled'], [false, 'N', 'n', 0, '0'], true)) {
                $result['state'] = 'closed';

                return $result;
            }
            if (! in_array($dialog['text_field_enabled'], [true, 'Y', 'y', 1, '1'], true)) {
                return $result;
            }
            $message = $this->latestInbound($crm, $chatId, $sessionId);
            if ($message === null) {
                return $result;
            }
            // Bitrix can import a WhatsApp message long after Edna received it.
            $at = $identity[0] === 'whatsappbyedna'
                ? $this->whatsappTimestamp($message, $identity)
                : $this->timestamp($message['date'] ?? null);
            if ($at === null || $at->isFuture()) {
                return $result;
            }
            if ($guardedDialog === null) {
                $epoch = filter_var($parts[6] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if (! $epoch) {
                    return $result;
                }
                $session = (new WebFormChatGuard($crm))->currentSession($chatId, $sessionId, $epoch);
                if (($session['source'] ?? '') !== $identity[0] || ! is_string($session['status'] ?? null) || ! array_key_exists('dateClose', $session)) {
                    return $result;
                }
                if ($session['status'] === 'closed' || ! empty($session['dateClose'])) {
                    $result['state'] = 'closed';

                    return $result;
                }
            }
            $deadline = $at->utc()->addHours(24);
            $result['expires_at'] = $deadline->format('Y-m-d\TH:i:s.u\Z');
            $result['state'] = $deadline->gt(now()) ? 'open' : 'expired';
        } catch (Throwable) {
            // A failed provider read is inconclusive. Do not log webhook URLs, message bodies or subscriber identity.
        }

        return $result;
    }

    /** Check again immediately before the POST, allowing its five-second transport timeout. */
    public static function blockReason(array $window): ?string
    {
        if ($window['state'] !== 'open') {
            return 'customer_window_'.$window['state'];
        }

        return CarbonImmutable::parse($window['expires_at'])->gt(now()->addSeconds(5)) ? null : 'customer_window_closing';
    }

    public static function blockedState(string $reason): string
    {
        return match ($reason) {
            'customer_window_closed' => 'preserved',
            'customer_window_expired' => 'expired',
            default => 'waiting',
        };
    }

    private function latestInbound(EdnaBitrix $crm, int $chatId, int $sessionId): ?array
    {
        $query = ['SESSION_ID' => $sessionId];
        $deadline = microtime(true) + 12;
        $pages = 0;
        // Bitrix returns session pages newest first. Stop as soon as the latest customer message is known.
        do {
            $history = $crm->call('imopenlines.session.history.get', $query);
            if (! is_array($history) || (string) ($history['sessionId'] ?? '') !== (string) $sessionId
                || (string) ($history['chatId'] ?? '') !== (string) $chatId || ! is_bool($history['hasNextPage'] ?? null)
                || ($history['tariffRestrictions']['isHistoryLimitExceeded'] ?? false) !== false
                || ! is_array($history['users'] ?? null) || ! is_array($history['message'] ?? null)) {
                return null;
            }
            $message = $this->lastCustomerMessage($history, $chatId, $query);
            $older = $history['hasNextPage'];
            if ($older) {
                $cursor = filter_var($history['nextId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                $date = filter_var($history['nextDate'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if (! $cursor || ! $date || (isset($query['LAST_DATE']) && [$date, $cursor] >= [$query['LAST_DATE'], $query['LAST_ID']])) {
                    return null;
                }
                $query += ['LIMIT' => 200];
                $query['LAST_ID'] = $cursor;
                $query['LAST_DATE'] = $date;
            }
            if ($message !== null) {
                return $message;
            }
        } while ($older && ++$pages < 3 && microtime(true) + 5 < $deadline);

        return null;
    }

    private function lastCustomerMessage(array $history, int $chatId, array $query): ?array
    {
        $last = null;
        $lastOrder = null;
        $orderedIds = [];
        foreach ($history['message'] as $message) {
            $id = filter_var($message['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $sender = $message['senderid'] ?? null;
            $date = $this->timestamp($message['date'] ?? null);
            if (! $id || ! $date || $date->isFuture() || isset($orderedIds[$id]) || (string) ($message['chatid'] ?? '') !== (string) $chatId
                || ! ctype_digit((string) $sender)) {
                throw new RuntimeException('Invalid native session history.');
            }
            $order = [$date->timestamp, $id];
            if (isset($query['LAST_DATE']) && $order >= [$query['LAST_DATE'], $query['LAST_ID']]) {
                throw new RuntimeException('Native page overlapped a newer message.');
            }
            $orderedIds[$id] = $order;
            if ((string) $sender === '0') {
                continue;
            }
            $isCustomer = $history['users'][$sender]['connector'] ?? null;
            if (! is_bool($isCustomer)) {
                throw new RuntimeException('Unidentified native sender.');
            }
            if (! $isCustomer || ($message['system'] ?? false) === true) {
                continue;
            }
            $params = $message['params'] ?? [];
            $params = is_string($params) ? json_decode($params, true) : $params;
            if (! is_array($params)) {
                throw new RuntimeException('Invalid native message attributes.');
            }
            if (str_contains(json_encode($params['class'] ?? ''), 'bx-messenger-content-item-ol-output')) {
                continue;
            }
            if ($lastOrder === null || $order > $lastOrder) {
                $lastOrder = $order;
                $last = $message;
                $last['params'] = $params;
            }
        }

        // The message object is keyed by ID. Never rely on its iteration order.
        arsort($orderedIds);
        $nativeOrder = $history['usersMessage']['chat'.$chatId] ?? null;
        if ($nativeOrder !== null && (! is_array($nativeOrder) || ! array_is_list($nativeOrder)
            || array_map('strval', $nativeOrder) !== array_map('strval', array_keys($orderedIds)))) {
            throw new RuntimeException('Native message order is inconsistent.');
        }
        if ($history['hasNextPage'] && end($orderedIds) !== [(int) ($history['nextDate'] ?? 0), (int) ($history['nextId'] ?? 0)]) {
            throw new RuntimeException('Native page boundary is inconsistent.');
        }

        return $last;
    }

    private function whatsappTimestamp(array $message, array $identity): ?CarbonImmutable
    {
        $subscriber = explode('@', $identity[2]);
        $mids = $message['params']['connectorMid'] ?? $message['params']['CONNECTOR_MID'] ?? null;
        $mids = is_array($mids) ? array_values($mids) : [$mids];
        if (count($subscriber) !== 2 || ! preg_match('/^[1-9]\d{5,14}$/D', $subscriber[0])
            || $subscriber[1] !== (string) config('edna.subject_id') || ! ctype_digit($subscriber[1])
            || $identity[3] !== (string) $message['senderid'] || count($mids) !== 1
            || (! is_int($mids[0]) && ! is_string($mids[0])) || ! preg_match('/^[1-9]\d*$/D', (string) $mids[0])
            || ! filter_var($mids[0], FILTER_VALIDATE_INT)) {
            return null;
        }
        [$phone, $subject] = $subscriber;
        $mid = (string) $mids[0];
        $encrypted = DB::table('edna_incoming_events')->where('subject_id', $subject)->where('message_id', $mid)->value('payload');
        if ($encrypted !== null) {
            try {
                $callback = json_decode(Crypt::decryptString($encrypted), true, 32, JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                $callback = null;
            }
        } else {
            $callback = null;
        }
        if (is_array($callback)) {
            if ((string) ($callback['id'] ?? '') !== $mid || (string) ($callback['subjectId'] ?? '') !== $subject
                || ($callback['subscriber']['identifier'] ?? null) !== $phone || ! $this->customerContent($callback['messageContent'] ?? null)) {
                return null;
            }

            $at = $this->timestamp($callback['receivedAt'] ?? null);
            if ($at !== null && ! $at->isFuture()) {
                return $at;
            }
            // Retention, old formats or a corrupt clock may leave the receipt unusable. Ask Edna for this MID.
        }
        $history = app(EdnaApi::class)->post('messages/history', [
            'subscriberFilter' => ['type' => 'PHONE', 'address' => $phone], 'subjectId' => (int) $subject,
            'messageId' => (int) $mid, 'direction' => 'IN', 'channelTypes' => ['WHATSAPP'], 'offset' => 0, 'limit' => 2,
        ]);
        $rows = $history->json('content');
        if ($history->status() !== 200 || $history->json('hasNext') !== false || ! is_array($rows) || ! array_is_list($rows) || count($rows) !== 1) {
            return null;
        }
        $row = $rows[0];
        $content = $row['content'] ?? null;
        if (($row['direction'] ?? '') !== 'IN' || ($row['channelType'] ?? '') !== 'WHATSAPP' || (string) ($row['subjectId'] ?? '') !== $subject
            || ($row['address'] ?? null) !== $phone || (string) ($row['messageId'] ?? '') !== $mid
            || ! $this->customerContent(is_string($content) ? json_decode($content, true) : $content)) {
            return null;
        }

        return $this->timestamp($row['sentOrReceivedAt'] ?? null);
    }

    private function customerContent(mixed $content): bool
    {
        return is_array($content) && in_array($content['type'] ?? null, [
            'TEXT', 'BUTTON', 'FLOW', 'LIST_PICKER', 'IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO', 'STICKER', 'LOCATION', 'CONTACT', 'PRODUCT', 'ORDER',
        ], true);
    }

    private function timestamp(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:?\d\d)$/D', $value)) {
            return null;
        }
        $parsed = new DateTimeImmutable($value);
        $errors = DateTimeImmutable::getLastErrors();

        return $errors === false ? CarbonImmutable::instance($parsed) : null;
    }
}
