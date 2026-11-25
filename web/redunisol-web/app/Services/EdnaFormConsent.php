<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

/** Authenticate the original outbound message before interpreting a native Edna button. */
class EdnaFormConsent
{
    private const CHOICES = ['Sí, quiero asesoramiento' => 'yes', 'No, gracias' => 'no'];

    public function __construct(private EdnaApi $api) {}

    public function candidate(array $payload): bool
    {
        $content = $payload['messageContent'] ?? [];
        $label = $content['text'] ?? null;

        return ($content['type'] ?? null) === 'BUTTON' && is_string($label) && isset(self::CHOICES[$label])
            && $this->id($payload['replyOutMessageId'] ?? null) !== null;
    }

    /** Null is an unrelated reply. Missing or conflicting provider evidence must be retried. */
    public function verifiedReply(array $payload): ?array
    {
        if (! $this->candidate($payload)) {
            return null;
        }
        $subject = $this->id($payload['subjectId'] ?? null);
        $phone = $payload['subscriber']['identifier'] ?? null;
        if ($subject === null || $subject !== (string) config('edna.subject_id')
            || ! is_string($phone) || ! preg_match('/^[0-9]{10,15}$/D', $phone)) {
            throw new RuntimeException('Form consent callback identity unavailable.');
        }
        $mid = (string) $payload['replyOutMessageId'];
        $received = $this->timestamp($payload['receivedAt'] ?? null);
        $rows = $this->history($subject, $phone, $received->subDays(365), $received, $mid);
        $matches = array_filter($rows, fn ($row) => is_array($row) && $this->id($row['messageId'] ?? null) === $mid);
        if (count($matches) !== 1) {
            throw new RuntimeException('Form consent original message unavailable.');
        }
        $message = reset($matches);
        $sent = $this->timestamp($message['sentOrReceivedAt'] ?? null);
        if (($message['direction'] ?? null) !== 'OUT' || ($message['channelType'] ?? null) !== 'WHATSAPP'
            || $this->id($message['subjectId'] ?? null) !== $subject || ($message['address'] ?? null) !== $phone
            || ! in_array($message['deliveryStatus'] ?? null, ['DELIVERED', 'READ'], true)
            || $sent->gt($received)) {
            throw new RuntimeException('Form consent original message not verified.');
        }

        $matcher = $this->id($message['matcherId'] ?? null);
        $name = $message['matcherName'] ?? null;
        if ($matcher === null || ! is_string($name) || trim($name) === '') {
            throw new RuntimeException('Form consent template identity unavailable.');
        }
        if ($matcher !== '58478' && $name !== 'recepcion_consentimiento_ok') {
            return null;
        }
        if ($matcher !== '58478' || $name !== 'recepcion_consentimiento_ok') {
            throw new RuntimeException('Form consent template identity inconsistent.');
        }
        $content = $message['content'] ?? null;
        $content = is_string($content) ? json_decode($content, true) : $content;
        $clicked = $payload['messageContent'];
        foreach ($content['keyboard']['rows'] ?? [] as $row) {
            foreach ($row['buttons'] ?? [] as $button) {
                if (($button['text'] ?? null) === $clicked['text'] && ($button['payload'] ?? null) === $clicked['text']
                    && ($clicked['payload'] ?? null) === $clicked['text']) {
                    $choice = self::CHOICES[$clicked['text']];
                    $outbound = ['messageId' => $mid, 'sentOrReceivedAt' => $sent->toISOString(),
                        'matcherId' => $matcher, 'subjectId' => $subject];
                    if ($choice === 'yes') {
                        $outbound['uniqueAroundSend'] = $this->uniqueAroundSend($subject, $phone, $mid, $sent);
                    }

                    return ['choice' => $choice, 'outbound' => $outbound];
                }
            }
        }

        throw new RuntimeException('Form consent button not verified.');
    }

    /** The native CRM emission is recorded to whole seconds and matched within three seconds. */
    private function uniqueAroundSend(string $subject, string $phone, string $mid, CarbonImmutable $sent): bool
    {
        $from = $sent->subSeconds(6)->startOfSecond();
        $to = $sent->addSeconds(6)->endOfSecond();
        if ($to->isFuture()) {
            throw new RuntimeException('Form consent send window is still open.');
        }
        $found = false;
        foreach ($this->history($subject, $phone, $from, $to) as $row) {
            if (! is_array($row) || ($row['direction'] ?? null) !== 'OUT' || ($row['channelType'] ?? null) !== 'WHATSAPP'
                || ($row['address'] ?? null) !== $phone || $this->id($row['subjectId'] ?? null) !== $subject) {
                throw new RuntimeException('Form consent send window is inconsistent.');
            }
            if ($this->id($row['matcherId'] ?? null) !== '58478' && ($row['matcherName'] ?? null) !== 'recepcion_consentimiento_ok') {
                continue;
            }
            $id = $this->id($row['messageId'] ?? null);
            $at = $this->timestamp($row['sentOrReceivedAt'] ?? null);
            if ($id === null || ! $at->betweenIncluded($from, $to)) {
                throw new RuntimeException('Form consent send window is incomplete.');
            }
            if ($id !== $mid) {
                return false;
            }
            if ($found || ! $at->equalTo($sent)) {
                throw new RuntimeException('Form consent original is inconsistent.');
            }
            $found = true;
        }
        if (! $found) {
            throw new RuntimeException('Form consent original is not visible in its send window.');
        }

        return true;
    }

    private function history(string $subject, string $phone, CarbonImmutable $from, CarbonImmutable $to, ?string $mid = null): array
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
            throw new RuntimeException('Form consent history unavailable.');
        }

        return $rows;
    }

    private function id(mixed $value): ?string
    {
        if (! is_int($value) && ! is_string($value)) {
            return null;
        }
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id !== false && (string) $value === (string) $id ? (string) $id : null;
    }

    private function timestamp(mixed $value): CarbonImmutable
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:?\d\d)$/D', $value)) {
            throw new RuntimeException('Form consent timestamp unavailable.');
        }

        return CarbonImmutable::parse($value);
    }
}
