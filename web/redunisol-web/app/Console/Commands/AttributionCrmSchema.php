<?php

namespace App\Console\Commands;

use App\Services\EdnaBitrix;
use Illuminate\Console\Command;
use Throwable;

class AttributionCrmSchema extends Command
{
    protected $signature = 'attribution:crm-schema {--apply : Add missing fields and Sin origen enum values}';

    protected $description = 'Verify attribution schema without modifying CRM records';

    public function handle(): int
    {
        try {
            $api = new EdnaBitrix;
            $missing = false;
            foreach (['contact', 'lead', 'deal'] as $entity) {
                $fields = $api->attributionSchema($entity, (bool) $this->option('apply'));
                if ($this->option('apply')) {
                    $fields = $api->attributionSchema($entity);
                }
                $missing = $missing || count($fields) > 0;
                $this->line(json_encode(['entity' => $entity, 'missing' => $fields]));
            }
            foreach (['lead' => 'UF_CRM_1722365051', 'deal' => 'UF_CRM_66A93764BFF96'] as $entity => $name) {
                $list = $api->call('crm.'.$entity.'.userfield.list', ['filter' => ['FIELD_NAME' => $name]]);
                if (count($list) !== 1 || $list[0]['USER_TYPE_ID'] !== 'enumeration') {
                    throw new \RuntimeException('Source field is not the expected enumeration.');
                }
                $field = $api->call('crm.'.$entity.'.userfield.get', ['id' => $list[0]['ID']]);
                $values = $field['LIST'] ?? null;
                if (! is_array($values) || count($values) === 0 || (string) ($field['ID'] ?? '') !== (string) $list[0]['ID']) {
                    throw new \RuntimeException('Incomplete source enumeration; refusing to update.');
                }
                $exists = collect($values)->contains(fn ($item) => mb_strtolower(trim($item['VALUE'])) === 'sin origen');
                if (! $exists && $this->option('apply')) {
                    // Retain every existing ID and value. Never replace the enumeration with a single option.
                    $values[] = ['VALUE' => 'Sin origen', 'SORT' => 999, 'DEF' => 'N', 'XML_ID' => 'ru_unknown_origin'];
                    $api->call('crm.'.$entity.'.userfield.update', ['id' => $field['ID'], 'fields' => ['LIST' => $values]]);
                    $field = $api->call('crm.'.$entity.'.userfield.get', ['id' => $field['ID']]);
                    $exists = collect($field['LIST'] ?? [])->contains(fn ($item) => $item['VALUE'] === 'Sin origen');
                }
                $this->line(json_encode(['entity' => $entity, 'sin_origen_present' => $exists]));
                $missing = $missing || ! $exists;
            }

            return $missing ? self::FAILURE : self::SUCCESS;
        } catch (Throwable) {
            $this->error('Attribution schema could not be verified. Check permissions and field types.');

            return self::FAILURE;
        }
    }
}
