<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

/** Stateless provider transport; the caller owns durable claims and transitions. */
class EdnaOrganicTransport
{
    public const TEXT = "¡Hola! 👋 Te comunicaste con el sector comercial de Red Unisol.\nPara ayudarte más rápido, contanos: ¿tu consulta es por un préstamo o por otro tema?";

    public const LOAN_LABEL = 'Quiero un préstamo';

    public const OTHER_LABEL = 'Otra consulta';

    private EdnaApi $api;

    public function __construct(?EdnaApi $api = null)
    {
        $this->api = $api ?? new EdnaApi;
    }

    public static function payload(string $requestUuid, string $choice): string
    {
        if (! Str::isUuid($requestUuid) || ! in_array($choice, ['loan', 'other'], true)) {
            throw new InvalidArgumentException('Invalid organic menu action.');
        }

        return 'organic:'.$requestUuid.':'.$choice;
    }

    public static function parseChoice(mixed $payload): ?array
    {
        if (! is_string($payload)
            || ! preg_match('/\Aorganic:([0-9a-fA-F-]{36}):(loan|other)\z/D', $payload, $matches)
            || ! Str::isUuid($matches[1])) {
            return null;
        }

        return ['request_id' => $matches[1], 'choice' => $matches[2]];
    }

    public function content(object|string $menu): array
    {
        $request = is_string($menu) ? $menu : (string) ($menu->request_id ?? '');

        return ['contentType' => 'TEXT', 'text' => self::TEXT,
            'keyboard' => ['rows' => [['buttons' => [
                ['text' => self::LOAN_LABEL, 'type' => 'QUICK_REPLY', 'payload' => self::payload($request, 'loan')],
                ['text' => self::OTHER_LABEL, 'type' => 'QUICK_REPLY', 'payload' => self::payload($request, 'other')],
            ]]]]];
    }

    /** Run before the caller claims the send; this method cannot send a message. */
    public function assertChannel(object $menu): void
    {
        try {
            $this->api->assertCascade($menu);
        } catch (Throwable) {
            throw new RuntimeException('Organic menu channel could not be verified.');
        }
    }

    public function schedule(object $menu): array
    {
        if (($menu->send_state ?? '') !== 'sending') {
            throw new RuntimeException('Organic menu send has not been claimed.');
        }
        $context = $this->context($menu);
        $payload = ['requestId' => $context['request'], 'comment' => $context['request'],
            'cascadeId' => $context['cascade'],
            'subscriberFilter' => ['address' => $context['phone'], 'type' => 'PHONE'],
            'content' => ['whatsappContent' => $this->content($menu)]];

        try {
            // Exactly one attempt: a timeout can occur after the provider sent it.
            $response = $this->api->post('cascade/schedule', $payload);
            if ($response->status() === 200 && $response->json('requestId') === $context['request']) {
                return ['send_state' => 'accepted', 'send_reason' => null, 'accepted_at' => now()];
            }
            if ($response->clientError() && ! in_array($response->status(), [408, 429], true)) {
                return ['send_state' => 'rejected', 'send_reason' => 'schedule_http_'.$response->status()];
            }
        } catch (Throwable) {
            // Never return the exception, response body, address or credential URL.
        }

        return ['send_state' => 'unknown', 'send_reason' => 'schedule_acknowledgement_uncertain'];
    }

    public function reconcile(object $menu): array
    {
        $unknown = ['send_state' => 'unknown', 'send_reason' => 'outgoing_history_unconfirmed',
            'outgoing_message_id' => $this->messageId($menu->outgoing_message_id ?? null)];

        try {
            $context = $this->context($menu);
            $end = CarbonImmutable::now()->min($context['started']->addHours(24));
            if ($end->lt($context['started'])) {
                return $unknown;
            }
            // This provider endpoint is a read, despite its HTTP POST contract.
            $response = $this->api->post('messages/history', [
                'subscriberFilter' => ['address' => $context['phone'], 'type' => 'PHONE'],
                'subjectId' => (int) $context['subject'], 'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'],
                'dateFrom' => $context['started']->subMinute()->toIso8601String(),
                'dateTo' => $end->toIso8601String(), 'limit' => 1000, 'offset' => 0,
                'sort' => [['property' => 'messageId', 'direction' => 'DESC']],
            ]);
            $rows = $response->json('content');
            if ($response->status() !== 200 || ! is_array($rows) || ! array_is_list($rows)
                || $response->json('hasNext') !== false) {
                return $unknown;
            }
            $matches = [];
            foreach ($rows as $message) {
                if (! is_array($message) || ($message['comment'] ?? null) !== $context['request']) {
                    continue;
                }
                $id = $this->messageId($message['messageId'] ?? null);
                if (! $id || ($message['direction'] ?? '') !== 'OUT' || ($message['channelType'] ?? '') !== 'WHATSAPP'
                    || (string) ($message['subjectId'] ?? '') !== $context['subject']
                    || (string) ($message['cascadeId'] ?? '') !== $context['cascade']
                    || ($message['address'] ?? null) !== $context['phone']
                    || (($menu->outgoing_message_id ?? null) !== null && (string) $menu->outgoing_message_id !== $id)
                    || (isset($matches[$id]) && $matches[$id] !== $message)) {
                    return $unknown;
                }
                $matches[$id] = $message;
            }
            if (count($matches) !== 1) {
                return $unknown;
            }
            $id = (string) array_key_first($matches);
            $message = $matches[$id];
            if (in_array($message['deliveryStatus'] ?? '', ['INVALID', 'FAILED', 'UNDELIVERED', 'CANCELLED'], true)) {
                return ['send_state' => 'rejected', 'send_reason' => 'outgoing_not_delivered', 'outgoing_message_id' => $id];
            }
            if (! in_array($message['deliveryStatus'] ?? '', ['SENT', 'DELIVERED', 'READ'], true)) {
                return $unknown;
            }
            $content = $message['content'] ?? null;
            $content = is_string($content) ? json_decode($content, true, 32, JSON_THROW_ON_ERROR) : $content;
            if (! is_array($content) || ($content['type'] ?? '') !== 'TEXT' || ($content['text'] ?? null) !== self::TEXT
                || (array_key_exists('keyboard', $content)
                    && $this->canonical($content['keyboard']) !== $this->canonical($this->content($menu)['keyboard']))) {
                return $unknown;
            }

            return ['send_state' => 'confirmed', 'send_reason' => null, 'outgoing_message_id' => $id, 'confirmed_at' => now()];
        } catch (Throwable) {
            return $unknown;
        }
    }

    private function context(object $menu): array
    {
        try {
            $request = (string) ($menu->request_id ?? '');
            $subject = (string) ($menu->subject_id ?? '');
            $cascade = (string) ($menu->cascade_id ?? '');
            $phone = Crypt::decryptString((string) ($menu->recipient ?? ''));
            $started = $menu->send_started_at ?? null;
            if (! Str::isUuid($request) || ! preg_match('/^[1-9][0-9]{0,63}$/D', $subject)
                || ! preg_match('/^[1-9][0-9]{0,63}$/D', $cascade) || ! preg_match('/^[0-9]{10,15}$/D', $phone)
                || (! $started instanceof DateTimeInterface && (! is_string($started) || trim($started) === ''))) {
                throw new RuntimeException;
            }

            return ['request' => $request, 'subject' => $subject, 'cascade' => $cascade,
                'phone' => $phone, 'started' => CarbonImmutable::parse($started)];
        } catch (Throwable) {
            throw new RuntimeException('Organic menu transport context is invalid.');
        }
    }

    private function messageId(mixed $value): ?string
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]{0,63}$/D', (string) $value)
            ? (string) $value : null;
    }

    private function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(fn ($item) => $this->canonical($item), $value);
    }
}
