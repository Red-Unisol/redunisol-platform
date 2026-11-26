<?php

namespace App\Services;

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
            $outbound['uniqueAroundSend'] = $this->uniqueAroundSend($outbound, $payload['subscriber']['identifier'], 'recepcion_consentimiento_ok');
        }

        return ['choice' => $choice, 'outbound' => $outbound];
    }
}
