<?php

namespace App\Services;

class EdnaMemberBenefitsButton extends EdnaTemplateButton
{
    public const CUTOVER = 'member-benefits-button-v1';

    public const MATCHER = '63510';

    public const OPERATOR = '117941';

    private const LABEL = 'Quiero mis beneficios';

    public function candidate(array $payload): bool
    {
        $button = $payload['messageContent'] ?? [];

        return ($button['type'] ?? null) === 'BUTTON' && ($button['text'] ?? null) === self::LABEL
            && $this->id($payload['replyOutMessageId'] ?? null) !== null;
    }

    public function verifiedReply(array $payload): ?array
    {
        return $this->candidate($payload) ? $this->outbound($payload, self::MATCHER, 'aviso_soysocio_v6final') : null;
    }
}
