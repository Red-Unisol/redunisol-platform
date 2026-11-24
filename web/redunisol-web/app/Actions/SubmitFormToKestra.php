<?php

namespace App\Actions;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

class SubmitFormToKestra
{
    public function execute(array $input, array $prequalification = [], ?string $guardedPayload = null): Response
    {
        $url = (string) config('services.kestra.form_webhook_url');

        if ($url === '') {
            throw new RuntimeException('Falta configurar services.kestra.form_webhook_url.');
        }

        // Old receivers see no CUIL, phone or email at the root and fail before touching CRM.
        $payload = $guardedPayload === null
            ? $this->buildPayload($input, $prequalification)
            : ['web_crm_delivery_v1' => $guardedPayload];

        return Http::acceptJson()
            ->asJson()
            ->timeout((int) config('services.kestra.form_webhook_timeout_seconds', 60))
            ->post($url, $payload);
    }

    public function guardedPayload(array $input, array $prequalification): string
    {
        return json_encode($this->buildPayload($input, $prequalification), JSON_THROW_ON_ERROR);
    }

    private function buildPayload(array $input, array $prequalification): array
    {
        $leadSource = $this->resolveLeadSource($input['utm_source'] ?? null, isset($input['attribution']));

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
            'attribution' => $input['attribution'] ?? null,
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
            'web_submission_id' => $input['_journey_links']['submission_id'] ?? null,
            'form_received_at' => $input['_form_received_at'] ?? null,
            'prequalification_available' => $prequalification['available'] ?? null,
            'prequalified' => $prequalification['prequalified'] ?? null,
            'route_to_whatsapp' => $prequalification['route_to_whatsapp'] ?? null,
            'prequalification_reason' => $this->normalizeString($prequalification['reason'] ?? null),
            'prequalification_message' => $this->normalizeString($prequalification['message'] ?? null),
            'prequalification_rule_version' => $this->normalizeString($prequalification['rule_version'] ?? null),
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

    private function resolveLeadSource(?string $utmSource, bool $attributed = false): string
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

        return $mapped ?? ($attributed ? 'Sin origen' : (string) config('services.kestra.default_lead_source', 'Google'));
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
