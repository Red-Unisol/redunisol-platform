<?php

namespace App\Services;

use App\Jobs\SyncEdnaFormLink;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

class EdnaFormLink
{
    public const HOME = 'https://redunisol.com.ar/';

    public const CRM_FIELD = 'UF_CRM_WA_FORM_URL';

    public const SEND_FIELD = 'UF_CRM_WA_SEND_FORM';

    public const STATUS_FIELD = 'UF_CRM_WA_FORM_STATUS';

    // Caller holds the inbox lock. No CRM calls or messages inside intake.
    public function capture(object $event, array $payload, string $kind): void
    {
        if (! config('edna.form_links_enabled') || ! config('attribution.enabled')
            || ($payload['messageContent']['type'] ?? '') !== 'TEXT'
            || ! in_array($kind, ['router_entry', 'ignored'], true)
            || $event->subject_id !== (string) config('edna.subject_id')) {
            return;
        }
        $phone = (string) $payload['subscriber']['identifier'];
        $journeys = new AttributionJourney;
        $hash = $journeys->phoneHash($phone);
        try {
            $received = CarbonImmutable::parse($payload['receivedAt']);
        } catch (\Throwable) {
            return;
        }
        $start = config('edna.router_start_at');
        if (! $hash || ! preg_match('/^[0-9]{10,15}$/D', $phone) || ! $start
            || $received->lt(CarbonImmutable::parse($start))
            || $received->lt(now()->subHours(23)) || $received->gt(now()->addMinutes(5))) {
            return;
        }
        $scope = hash('sha256', $event->subject_id.':'.$hash);
        DB::table('edna_form_links')->insertOrIgnore([
            'scope' => $scope, 'subject_id' => $event->subject_id, 'recipient' => Crypt::encryptString($phone),
            'entry_event_id' => $event->id, 'last_event_id' => $event->id,
            'entry_received_at' => $received, 'last_received_at' => $received,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $current = DB::table('edna_form_links')->where('scope', $scope)->lockForUpdate()->first();
        $last = CarbonImmutable::parse($current->last_received_at);
        if ($received->lt($last) || ($received->eq($last) && (int) $event->id < (int) $current->last_event_id)) {
            return;
        }
        $text = $payload['messageContent']['text'];
        // An explicit but malformed reference also starts an unresolved context.
        $newContext = (int) $current->entry_event_id === (int) $event->id || $kind === 'router_entry'
            || preg_match('/\(ref\s*:/i', $text)
            || $received->gte(CarbonImmutable::parse($current->entry_received_at)->addHours(24));
        $values = ['last_event_id' => $event->id, 'last_received_at' => $received, 'updated_at' => now()];
        if ($newContext) {
            $values += ['entry_event_id' => $event->id, 'entry_received_at' => $received,
                'recipient' => Crypt::encryptString($phone),
                'journey_id' => $journeys->bind($text, $phone, $event->subject_id),
                'crm_entity' => null, 'crm_id' => null, 'crm_state' => 'pending', 'crm_reason' => null];
        }
        DB::table('edna_form_links')->where('scope', $scope)->update($values);
        if ($newContext) {
            Queue::connection('edna')->push(new SyncEdnaFormLink($scope, (int) $event->id), '', 'edna');
        }
    }

    public function canSendTo(string $phone): bool
    {
        $recipients = config('edna.form_link_recipients', []);

        return config('edna.enabled') && config('edna.form_links_enabled') && config('edna.form_link_send_enabled')
            && (! $recipients || in_array($phone, $recipients, true));
    }

    public function reference(object $context): ?string
    {
        if (! config('attribution.enabled') || ! config('edna.form_links_enabled')
            || CarbonImmutable::parse($context->entry_received_at)->lte(now()->subHours(24))) {
            return null;
        }
        $journeys = new AttributionJourney;
        $journey = $journeys->find($context->journey_id);
        $hash = $journeys->phoneHash(Crypt::decryptString($context->recipient));

        return $journey && $hash && $journey->recipient_hash
            && hash_equals($journey->recipient_hash, $hash) && $journey->subject_id === $context->subject_id
            ? $journey->id : null;
    }

    public function url(object $context): string
    {
        $reference = $this->reference($context);

        return self::HOME.($reference ? '?ref='.$reference : '');
    }

    public function schema(string $entity, bool $apply = false): array
    {
        if (! in_array($entity, ['contact', 'lead'], true)) {
            throw new \RuntimeException('Unsupported form link entity.');
        }
        $api = new EdnaBitrix;
        $fields = $api->call('crm.'.$entity.'.fields');
        $missing = [];
        foreach ([self::CRM_FIELD => ['string', 'Enlace al formulario (WhatsApp)'],
            self::SEND_FIELD => ['boolean', 'Enviar formulario por WhatsApp'],
            self::STATUS_FIELD => ['string', 'Estado envío formulario']] as $key => [$type, $label]) {
            $field = $fields[$key] ?? null;
            if ($field) {
                if (($field['type'] ?? '') !== $type || ($field['isMultiple'] ?? false)) {
                    throw new \RuntimeException('Incompatible form link field.');
                }
            } else {
                $missing[] = $key;
                if ($apply) {
                    $api->call('crm.'.$entity.'.userfield.add', ['fields' => [
                        'FIELD_NAME' => substr($key, 7), 'USER_TYPE_ID' => $type,
                        'XML_ID' => 'redunisol_'.strtolower(substr($key, 7)), 'MULTIPLE' => 'N', 'MANDATORY' => 'N',
                        'EDIT_FORM_LABEL' => ['es' => $label], 'LIST_COLUMN_LABEL' => ['es' => $label],
                        'SETTINGS' => $type === 'boolean' ? ['DEFAULT_VALUE' => 0, 'DISPLAY' => 'CHECKBOX'] : ['ROWS' => 1],
                    ]]);
                }
            }
        }

        return $apply && $missing ? $this->schema($entity) : $missing;
    }

    public function layout(string $entity, bool $apply = false): array
    {
        if (! in_array($entity, ['contact', 'lead'], true) || $this->schema($entity)) {
            throw new \RuntimeException('Form link schema must exist before configuring the card.');
        }
        $api = new EdnaBitrix;
        $method = 'crm.'.$entity.'.details.configuration.';
        $sections = $api->call($method.'get', ['scope' => 'C']);
        if (! is_array($sections) || ! array_is_list($sections) || ! $sections) {
            throw new \RuntimeException('Existing shared card configuration is unavailable.');
        }
        $existing = collect($sections)->flatMap(fn ($section) => $section['elements'] ?? [])->pluck('name')->all();
        $missing = array_values(array_diff([self::CRM_FIELD, self::SEND_FIELD, self::STATUS_FIELD], $existing));
        if ($apply && $missing) {
            $original = $sections;
            $sectionName = 'redunisol_whatsapp_form';
            $position = array_search($sectionName, array_column($sections, 'name'), true);
            $elements = array_map(fn ($name) => ['name' => $name, 'optionFlags' => 1], $missing);
            if ($position === false) {
                $sections[] = ['name' => $sectionName, 'title' => 'Formulario por WhatsApp', 'type' => 'section', 'elements' => $elements];
            } else {
                $sections[$position]['elements'] = array_merge($sections[$position]['elements'] ?? [], $elements);
            }
            if ($api->call($method.'get', ['scope' => 'C']) !== $original) {
                throw new \RuntimeException('The shared card changed during inspection; retry from its current state.');
            }
            $api->call($method.'set', ['scope' => 'C', 'data' => $sections]);

            return $this->layout($entity);
        }

        return $missing;
    }
}
