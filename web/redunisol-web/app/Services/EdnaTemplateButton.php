<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

/** Matches an authenticated callback to the exact delivered WhatsApp template and button. */
class EdnaTemplateButton
{
    public function __construct(private EdnaApi $api) {}

    protected function outbound(array $payload, string $matcherId, string $matcherName): ?array
    {
        $subject = $this->id($payload['subjectId'] ?? null);
        $phone = $payload['subscriber']['identifier'] ?? null;
        if ($subject === null || $subject !== (string) config('edna.subject_id')
            || ! is_string($phone) || ! preg_match('/^[0-9]{10,15}$/D', $phone)) {
            throw new RuntimeException('Template button callback identity unavailable.');
        }
        $mid = (string) $payload['replyOutMessageId'];
        $received = $this->timestamp($payload['receivedAt'] ?? null);
        $rows = $this->history($subject, $phone, $received->subDays(365), $received, $mid);
        $matches = array_filter($rows, fn ($row) => is_array($row) && $this->id($row['messageId'] ?? null) === $mid);
        if (count($matches) !== 1) {
            throw new RuntimeException('Template button original message unavailable.');
        }
        $message = reset($matches);
        $sent = $this->timestamp($message['sentOrReceivedAt'] ?? null);
        if (($message['direction'] ?? null) !== 'OUT' || ($message['channelType'] ?? null) !== 'WHATSAPP'
            || $this->id($message['subjectId'] ?? null) !== $subject || ($message['address'] ?? null) !== $phone
            || ! in_array($message['deliveryStatus'] ?? null, ['DELIVERED', 'READ'], true)
            || $sent->gt($received)) {
            throw new RuntimeException('Template button original message not verified.');
        }

        $matcher = $this->id($message['matcherId'] ?? null);
        $name = $message['matcherName'] ?? null;
        if ($matcher === null || ! is_string($name) || trim($name) === '') {
            throw new RuntimeException('Template button template identity unavailable.');
        }
        if ($matcher !== $matcherId && $name !== $matcherName) {
            return null;
        }
        if ($matcher !== $matcherId || $name !== $matcherName) {
            throw new RuntimeException('Template button template identity inconsistent.');
        }
        $content = $message['content'] ?? null;
        $content = is_string($content) ? json_decode($content, true) : $content;
        $clicked = $payload['messageContent'];
        foreach ($content['keyboard']['rows'] ?? [] as $row) {
            foreach ($row['buttons'] ?? [] as $button) {
                if (($button['text'] ?? null) === $clicked['text'] && is_string($clicked['payload'] ?? null) && $clicked['payload'] !== ''
                    && ($button['payload'] ?? null) === $clicked['payload']) {
                    return ['messageId' => $mid, 'sentOrReceivedAt' => $sent->toISOString(),
                        'matcherId' => $matcher, 'subjectId' => $subject];
                }
            }
        }

        throw new RuntimeException('Template button not verified.');
    }

    protected function history(string $subject, string $phone, CarbonImmutable $from, CarbonImmutable $to, ?string $mid = null): array
    {
        $query = ['subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'], 'subjectId' => (int) $subject,
            'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'], 'dateFrom' => $from->toISOString(),
            'dateTo' => $to->toISOString(), 'offset' => 0, 'limit' => 1000];
        if ($mid !== null) {
            $query['messageId'] = (int) $mid;
        }
        $response = $this->api->post('messages/history', $query);
        $rows = $response->json('content');
        if ($response->status() !== 200 || ! is_array($rows) || ! array_is_list($rows) || $response->json('hasNext') !== false) {
            throw new RuntimeException('Template button history unavailable.');
        }

        return $rows;
    }

    protected function id(mixed $value): ?string
    {
        if (! is_int($value) && ! is_string($value)) {
            return null;
        }
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id !== false && (string) $value === (string) $id ? (string) $id : null;
    }

    protected function timestamp(mixed $value): CarbonImmutable
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:?\d\d)$/D', $value)) {
            throw new RuntimeException('Template button timestamp unavailable.');
        }

        return CarbonImmutable::parse($value);
    }
}
