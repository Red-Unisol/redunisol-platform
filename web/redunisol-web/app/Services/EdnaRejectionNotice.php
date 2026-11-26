<?php

namespace App\Services;

use Throwable;

/** Recognizes public robot copy; delivery, rejection date and human guards belong to the caller. */
class EdnaRejectionNotice
{
    public const NORMALIZATION = 'crlf-to-lf-ascii-edge-space-v1';

    private ?array $notices = null;

    public function __construct(private ?string $catalogPath = null) {}

    public function match(string $text, string $reasonLabel): ?array
    {
        return $this->matchNotice($text, $reasonLabel, false);
    }

    public function matchDeal(string $text, string $stageId): ?array
    {
        $reason = EdnaRejectedDealDiscovery::STAGE_REASONS[$stageId] ?? null;
        if ($reason === null) {
            return null;
        }

        return $this->matchNotice($text, $reason, $stageId === 'C1:5');
    }

    private function matchNotice(string $text, string $reasonLabel, bool $allowBcraDealGreeting): ?array
    {
        $text = $this->normalize($text);
        $reasonLabel = $this->normalize($reasonLabel);
        if ($text === null || $reasonLabel === null) {
            return null;
        }
        foreach ($this->notices() as $notice) {
            if ($notice['reason_label'] !== $reasonLabel) {
                continue;
            }
            // Bitrix also sends this exact greeting and sign-off around the BCRA deal notice.
            if (hash_equals($notice['normalized_sha256'], hash('sha256', $text))
                || ($allowBcraDealGreeting && $text === '¡Hola! '.$this->normalize($notice['text']).'  ¡Gracias por tu consulta!')) {
                return ['template_sha256' => $notice['template_sha256']];
            }
        }

        return null;
    }

    private function normalize(string $text): ?string
    {
        if (strlen($text) > 20000 || preg_match('//u', $text) !== 1) {
            return null;
        }
        $text = trim(str_replace(["\r\n", "\r"], "\n", $text), " \t\n");

        return $text !== '' && ! str_contains($text, '{=') && ! str_contains($text, '{{') && ! str_contains($text, '${') ? $text : null;
    }

    private function notices(): array
    {
        if ($this->notices !== null) {
            return $this->notices;
        }
        $this->notices = [];
        try {
            $path = $this->catalogPath ?? dirname(__DIR__, 2).'/resources/crm/rejection-notices.json';
            if (! is_file($path) || filesize($path) > 1000000) {
                return [];
            }
            $catalog = json_decode(file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
            if (($catalog['schema_version'] ?? null) !== 1 || ($catalog['normalization'] ?? '') !== self::NORMALIZATION
                || ! is_array($catalog['notices'] ?? null) || ! array_is_list($catalog['notices'])
                || count($catalog['notices']) > 100) {
                return [];
            }
            $labels = [];
            foreach ($catalog['notices'] as $notice) {
                if (! is_array($notice) || ! is_string($notice['reason_label'] ?? null) || ! is_string($notice['text'] ?? null)
                    || ! is_string($notice['template_sha256'] ?? null) || ! is_string($notice['normalized_sha256'] ?? null)
                    || isset($labels[$notice['reason_label']]) || $this->normalize($notice['reason_label']) !== $notice['reason_label']
                    || ($normalized = $this->normalize($notice['text'])) === null
                    || ! hash_equals(hash('sha256', $notice['text']), $notice['template_sha256'])
                    || ! hash_equals(hash('sha256', $normalized), $notice['normalized_sha256'])) {
                    return [];
                }
                $labels[$notice['reason_label']] = true;
            }

            return $this->notices = $catalog['notices'];
        } catch (Throwable) {
            return [];
        }
    }
}
