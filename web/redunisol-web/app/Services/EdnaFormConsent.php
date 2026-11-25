<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

/** Authenticate the original outbound message before interpreting a native Edna button. */
class EdnaFormConsent extends EdnaTemplateButton
{
    private const CHOICES = ['Sí, quiero asesoramiento' => 'yes', 'No, gracias' => 'no'];

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
        $outbound = $this->outbound($payload, '58478', 'recepcion_consentimiento_ok');
        if ($outbound === null) {
            return null;
        }
        if (($payload['messageContent']['payload'] ?? null) !== $payload['messageContent']['text']) {
            throw new RuntimeException('Form consent button not verified.');
        }
        $choice = self::CHOICES[$payload['messageContent']['text']];
        if ($choice === 'yes') {
            $outbound['uniqueAroundSend'] = $this->uniqueAroundSend($outbound['subjectId'], $payload['subscriber']['identifier'],
                $outbound['messageId'], $this->timestamp($outbound['sentOrReceivedAt']));
        }

        return ['choice' => $choice, 'outbound' => $outbound];
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
}
