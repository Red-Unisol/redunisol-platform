<?php

namespace App\Actions;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

class SubmitFormToKestra
{
    public function execute(array $input): Response
    {
        $url = (string) config('services.kestra.form_webhook_url');

        if ($url === '') {
            throw new RuntimeException('Falta configurar services.kestra.form_webhook_url.');
        }

        return Http::acceptJson()
            ->asJson()
            ->timeout((int) config('services.kestra.form_webhook_timeout_seconds', 60))
            ->post($url, $this->buildPayload($input));
    }

    private function buildPayload(array $input): array
    {
        $leadSource = $this->resolveLeadSource($input['utm_source'] ?? null);

        return array_filter([
            'full_name' => $this->inferFullName($input),
            'full_name_inferred' => true,
            'email' => $this->normalizeString($input['email'] ?? null),
            'whatsapp' => $this->normalizeString($input['celular'] ?? null),
            'cuil' => $this->normalizeString($input['cuil'] ?? null),
            'province' => $this->normalizeString($input['provincia'] ?? null),
            'employment_status' => $this->normalizeString($input['situacion_laboral'] ?? null),
            'payment_bank' => $this->normalizeString($input['banco'] ?? null),
            'lead_source' => $leadSource,
            'landing_slug' => $this->normalizeString($input['landing_slug'] ?? null),
            'landing_title' => $this->normalizeString($input['landing_title'] ?? null),
            'landing_url' => $this->normalizeString($input['landing_url'] ?? null),
            'recibo_url' => $this->normalizeString($input['recibo_url'] ?? null),
            'utm_source' => $this->normalizeString($input['utm_source'] ?? null),
            'utm_medium' => $this->normalizeString($input['utm_medium'] ?? null),
            'utm_campaign' => $this->normalizeString($input['utm_campaign'] ?? null),
            'utm_term' => $this->normalizeString($input['utm_term'] ?? null),
            'utm_content' => $this->normalizeString($input['utm_content'] ?? null),
            'submission_channel' => 'redunisol-web',
        ], static fn (mixed $value): bool => $value !== null && $value !== '');
    }

    private function inferFullName(array $input): string
    {
        $email = $this->normalizeString($input['email'] ?? null);

        if ($email !== null && str_contains($email, '@')) {
            $localPart = Str::before($email, '@');
            $candidate = preg_replace('/[._-]+/', ' ', $localPart) ?? '';
            $candidate = trim(preg_replace('/\s+/', ' ', $candidate) ?? '');

            if ($candidate !== '' && preg_match('/[a-zA-Z]/', $candidate) === 1) {
                return Str::title($candidate);
            }
        }

        $landingTitle = $this->normalizeString($input['landing_title'] ?? null);

        if ($landingTitle !== null) {
            return 'Lead Web '.Str::limit($landingTitle, 80, '');
        }

        return 'Lead Web Redunisol';
    }

    private function resolveLeadSource(?string $utmSource): string
    {
        $source = Str::of((string) $utmSource)->trim()->lower()->toString();

        $mapped = match ($source) {
            'google', 'googleads', 'gads' => 'Google',
            'facebook', 'fb', 'meta' => 'Facebook',
            'instagram', 'ig' => 'Instagram',
            'whatsapp', 'wa' => 'WhatsApp',
            'email', 'e-mail', 'mail' => 'E Mail',
            'youtube', 'yt' => 'YouTube',
            default => null,
        };

        return $mapped ?? (string) config('services.kestra.default_lead_source', 'Google');
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
