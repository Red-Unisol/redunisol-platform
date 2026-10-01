<?php

namespace App\Services;

use RuntimeException;

class EdnaFormTemplate
{
    public const NAME = 'boton_home_atribucion';

    public const TEXT = "*Hola! Te comunicaste con el Sector Comercial de Red Unisol.* 👋\n\n*Completá tus datos y realizá una precalificación inicial.*\n\nSi tu perfil cumple con las condiciones para avanzar, el sistema te redirige automáticamente a WhatsApp para continuar la gestión con un asesor humano.\n\nUsá el botón para ingresar al sitio y continuar con tu evaluación.";

    public const BUTTON = 'Precalificar ahora';

    // Whole query is dynamic, so the same approved template supports an untagged home URL.
    public const URL = EdnaFormLink::HOME.'{{1}}';

    public function definition(): array
    {
        return ['name' => self::NAME, 'channelType' => 'WHATSAPP', 'language' => 'es_AR',
            'category' => 'MARKETING', 'type' => 'OPERATOR',
            'contentType' => 'TEXT', 'content' => ['text' => self::TEXT, 'keyboard' => ['rows' => [['buttons' => [[
                'text' => self::BUTTON, 'buttonType' => 'URL', 'url' => self::URL,
                'urlTextExample' => EdnaFormLink::HOME.'?ref=Ab12Cd34Ef', 'shouldCollectClicks' => false,
            ]]]]]]];
    }

    public function inspect(bool $create = false): array
    {
        $api = new EdnaApi;
        $response = $api->post('message-matchers/get-by-request', [
            'subjectId' => (int) config('edna.subject_id'), 'matcherTypes' => ['OPERATOR'],
        ]);
        if ($response->status() !== 200 || ! is_array($response->json()) || ! array_is_list($response->json())) {
            throw new RuntimeException('Template list unavailable.');
        }
        $matches = array_values(array_filter($response->json(), fn ($t) => ($t['name'] ?? '') === self::NAME));
        if (! $matches && $create) {
            $created = $api->post('message-matchers', ['messageMatcher' => $this->definition(),
                'subjectIds' => [(int) config('edna.subject_id')]]);
            if ($created->status() !== 200) {
                throw new RuntimeException('Template registration not acknowledged; inspect before retrying.');
            }

            return $this->inspect();
        }
        if (count($matches) !== 1) {
            return ['status' => $matches ? 'ambiguous' : 'missing'];
        }
        $template = $matches[0];
        $rows = $template['content']['keyboard']['rows'] ?? [];
        $button = $rows[0]['buttons'][0] ?? [];
        if (($template['channelType'] ?? '') !== 'WHATSAPP' || ($template['language'] ?? '') !== 'es_AR'
            || ($template['type'] ?? '') !== 'OPERATOR' || ($template['content']['text'] ?? '') !== self::TEXT
            || ! empty($template['content']['header']) || ! empty($template['content']['footer'])
            || count($rows) !== 1 || count($rows[0]['buttons'] ?? []) !== 1
            || ($button['url'] ?? '') !== self::URL || ($button['buttonType'] ?? '') !== 'URL'
            || ($button['text'] ?? '') !== self::BUTTON || ($template['locked'] ?? false)) {
            throw new RuntimeException('Template differs from the versioned definition.');
        }

        return ['id' => $template['id'], 'status' => $template['status']];
    }

    public function content(?string $reference): array
    {
        // A bare query avoids empty dynamic parameters without inventing acquisition UTMs.
        $postfix = $reference ? '?ref='.$reference : '?';

        return ['contentType' => 'TEXT', 'text' => self::TEXT,
            'keyboard' => ['rows' => [['buttons' => [[
                'text' => self::BUTTON, 'type' => 'URL', 'url' => EdnaFormLink::HOME,
                'urlPostfix' => $postfix,
            ]]]]]];
    }
}
