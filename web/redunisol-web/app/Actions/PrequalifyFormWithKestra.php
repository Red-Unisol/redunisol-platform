<?php

namespace App\Actions;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class PrequalifyFormWithKestra
{
    public function execute(array $input): Response
    {
        $url = (string) config('services.kestra.prequalification_webhook_url');

        if ($url === '') {
            throw new RuntimeException('Falta configurar services.kestra.prequalification_webhook_url.');
        }

        return Http::acceptJson()
            ->asJson()
            ->timeout((int) config('services.kestra.prequalification_webhook_timeout_seconds', 15))
            ->post($url, [
                'province' => $this->normalizeString($input['provincia'] ?? null),
                'employment_status' => $this->normalizeString($input['situacion_laboral'] ?? null),
                'payment_bank' => $this->normalizeString($input['banco'] ?? null),
            ]);
    }

    private function normalizeString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $normalized = trim($value);

        return $normalized === '' ? null : $normalized;
    }
}
