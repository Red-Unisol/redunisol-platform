<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

class MetaConversionsApiService
{
    public function sendLead(array $input, array $clientContext = []): void
    {
        $pixelId = (string) config('services.meta.pixel_id');
        $accessToken = (string) config('services.meta.capi_access_token');

        if ($pixelId === '' || $accessToken === '') {
            return;
        }

        $event = array_filter([
            'event_name' => 'Lead',
            'event_time' => time(),
            'event_id' => $this->normalizeString($input['meta_event_id'] ?? null),
            'action_source' => 'website',
            'event_source_url' => $this->normalizeString($input['landing_url'] ?? null) ?: url()->current(),
            'user_data' => $this->buildUserData($input, $clientContext),
            'custom_data' => array_filter([
                'content_name' => 'lead_form',
                'landing_slug' => $this->normalizeString($input['landing_slug'] ?? null),
                'landing_title' => $this->normalizeString($input['landing_title'] ?? null),
                'utm_source' => $this->normalizeString($input['utm_source'] ?? null),
                'utm_medium' => $this->normalizeString($input['utm_medium'] ?? null),
                'utm_campaign' => $this->normalizeString($input['utm_campaign'] ?? null),
                'utm_term' => $this->normalizeString($input['utm_term'] ?? null),
                'utm_content' => $this->normalizeString($input['utm_content'] ?? null),
            ], static fn (mixed $value): bool => $value !== null && $value !== ''),
        ], static fn (mixed $value): bool => $value !== null && $value !== '');

        $payload = [
            'data' => [$event],
        ];

        $testEventCode = (string) config('services.meta.capi_test_event_code');
        if ($testEventCode !== '') {
            $payload['test_event_code'] = $testEventCode;
        }

        try {
            $version = (string) config('services.meta.capi_graph_version', 'v23.0');
            $response = Http::asJson()
                ->withToken($accessToken)
                ->timeout(5)
                ->post("https://graph.facebook.com/{$version}/{$pixelId}/events", $payload);

            if ($response->failed()) {
                report(new \RuntimeException(
                    'Meta Conversions API request failed: '.$response->status().' '.$response->body()
                ));
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    private function buildUserData(array $input, array $clientContext): array
    {
        return array_filter([
            'em' => $this->hashEmail($input['email'] ?? null),
            'ph' => $this->hashPhone($input['celular'] ?? null),
            'client_ip_address' => $this->normalizeString($clientContext['ip'] ?? null),
            'client_user_agent' => $this->normalizeString($clientContext['user_agent'] ?? null),
            'fbp' => $this->normalizeString($clientContext['fbp'] ?? null),
            'fbc' => $this->normalizeString($clientContext['fbc'] ?? null),
        ], static fn (mixed $value): bool => $value !== null && $value !== '');
    }

    private function hashEmail(mixed $value): ?string
    {
        $email = $this->normalizeString($value);

        if ($email === null) {
            return null;
        }

        return hash('sha256', Str::lower($email));
    }

    private function hashPhone(mixed $value): ?string
    {
        $phone = $this->normalizeString($value);

        if ($phone === null) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $phone) ?? '';

        return $digits === '' ? null : hash('sha256', $digits);
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
