<?php

namespace App\Support;

use App\Models\SiteSetting;
use App\Services\EdnaOutOfHoursPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class WhatsAppOutOfHoursSettings
{
    public const KEY = 'whatsapp_out_of_hours_sales';

    public function defaults(): array
    {
        return [
            'enabled' => false, 'enabled_since' => null,
            'timezone' => 'America/Argentina/Cordoba', 'open' => '09:00', 'close' => '17:00',
            'weekdays' => [1, 2, 3, 4, 5], 'holidays' => [],
            'managed_text' => '{saludo} Recibimos tu mensaje. En este momento estamos fuera de nuestro horario de atención. {asesor} va a continuar con tu gestión {proxima_apertura}. Horario de atención: {horario}.',
            'general_text' => '¡Hola! Recibimos tu mensaje. En este momento estamos fuera de nuestro horario de atención. Un asesor te va a responder {proxima_apertura}. Horario de atención: {horario}.',
        ];
    }

    public function get(): array
    {
        $stored = json_decode((string) SiteSetting::get(self::KEY, '{}'), true, 16, JSON_THROW_ON_ERROR);

        return array_replace($this->defaults(), $stored);
    }

    public function save(array $data): void
    {
        $valid = Validator::make($data, [
            'enabled' => ['required', 'boolean'], 'timezone' => ['required', 'timezone'],
            'open' => ['required', 'date_format:H:i'], 'close' => ['required', 'date_format:H:i', 'after:open'],
            'weekdays' => ['required', 'array', 'min:1', 'max:7'],
            'weekdays.*' => ['integer', 'between:1,7', 'distinct'],
            'holidays' => ['present', 'array', 'max:366'], 'holidays.*' => ['date_format:Y-m-d', 'distinct'],
            'managed_text' => ['required', 'string', 'max:2000'], 'general_text' => ['required', 'string', 'max:2000'],
        ])->validate();
        foreach (['managed_text', 'general_text'] as $key) {
            $this->assertText($valid[$key], $key);
        }
        $previous = $this->get();
        $valid['weekdays'] = array_map('intval', $valid['weekdays']);
        $valid['enabled_since'] = $valid['enabled']
            ? ($previous['enabled'] ? $previous['enabled_since'] : now()->toIso8601String()) : null;
        SiteSetting::set(self::KEY, json_encode($valid, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    public function assertText(string $text, string $key = 'general_text'): void
    {
        // A domain, URL or markup link would recreate the competing web invitation.
        if (preg_match('~(?:https?://|www\.|\[url|[a-z0-9-]+\.(?:[a-z]{2,})(?:\b|/))~iu', $text)
            || preg_match('/\{(?!saludo\}|asesor\}|proxima_apertura\}|horario\})[^}]*\}/u', $text)) {
            throw ValidationException::withMessages([$key => 'Use texto sin enlaces y solo las variables indicadas.']);
        }
    }

    // Historical reports use the same Kestra calendar as live decisions.
    public function window(CarbonImmutable $instant, ?array $settings = null): ?array
    {
        $row = (new EdnaOutOfHoursPolicy)->calendar([$instant->toIso8601String()], $settings ?? $this->get())[0];
        $window = $row['window'];

        return $window ? ['start' => CarbonImmutable::parse($window['window_start']),
            'end' => CarbonImmutable::parse($window['window_end'])] : null;
    }

    // Only presentation of verified names stays in the transport adapter.
    public function personalize(string $template, array $context): string
    {
        $text = strtr($template, [
            '{saludo}' => empty($context['name']) ? '¡Hola!' : '¡Hola, '.$context['name'].'!',
            '{asesor}' => $context['advisor_name'] ?? 'Un asesor',
        ]);
        $this->assertText($text);
        if (preg_match('/[{}]/u', $text)) {
            throw new \RuntimeException('Unresolved Kestra notice template.');
        }

        return $text;
    }
}
