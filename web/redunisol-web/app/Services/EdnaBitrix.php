<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class EdnaBitrix
{
    public const FIELDS = [
        'WA_ASSISTED' => 'string', 'WA_ENTRY' => 'string', 'WA_FLOW' => 'string',
        'WA_PROVINCE' => 'string', 'WA_SEGMENT' => 'string', 'WA_FLOW_ID' => 'string', 'WA_TIMESTAMP' => 'datetime',
    ];

    public function call(string $method, array $payload = []): mixed
    {
        $url = (string) config('edna.bitrix_url');
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || parse_url($url, PHP_URL_HOST) !== 'redunisol.bitrix24.es'
            || ! preg_match('#^/rest/[0-9]+/[A-Za-z0-9]+/?$#D', (string) parse_url($url, PHP_URL_PATH))) {
            throw new RuntimeException('Edna Bitrix access is not configured.');
        }
        try {
            $response = Http::asJson()->acceptJson()->connectTimeout(3)->timeout(5)->withoutRedirecting()
                ->post(rtrim($url, '/').'/'.$method.'.json', $payload);
            $data = $response->json();
            if (! $response->successful() || ! is_array($data) || isset($data['error']) || ! array_key_exists('result', $data)) {
                throw new RuntimeException('Bitrix did not acknowledge the operation.');
            }

            return $data['result'];
        } catch (Throwable) {
            // The webhook URL is a credential. Never retain the HTTP exception.
            throw new RuntimeException('Edna Bitrix operation failed; inspect the result ID.');
        }
    }

    public function schema(string $entity, bool $apply = false): array
    {
        if (! in_array($entity, ['contact', 'lead'], true)) {
            throw new RuntimeException('Unsupported CRM entity.');
        }
        $fields = $this->call('crm.'.$entity.'.fields');
        if (! is_array($fields)) {
            throw new RuntimeException('Invalid CRM schema.');
        }
        $missing = [];
        foreach (self::FIELDS as $name => $type) {
            $key = 'UF_CRM_'.$name;
            if (isset($fields[$key])) {
                if (($fields[$key]['type'] ?? '') !== $type || ($fields[$key]['isMultiple'] ?? false)) {
                    throw new RuntimeException('Existing WA field has incompatible schema.');
                }
            } else {
                $missing[] = $key;
                if ($apply) {
                    $this->call('crm.'.$entity.'.userfield.add', ['fields' => [
                        'FIELD_NAME' => $name, 'USER_TYPE_ID' => $type, 'LABEL' => $name,
                        'XML_ID' => 'redunisol_router_'.$name, 'MULTIPLE' => 'N', 'MANDATORY' => 'N',
                        'SHOW_FILTER' => 'Y',
                    ]]);
                }
            }
        }

        return $missing;
    }

    public function find(string $phone): array
    {
        // Contacts are the stable person record; never pick one arbitrary lead among duplicates.
        foreach (['contact', 'lead'] as $entity) {
            $result = $this->call('crm.duplicate.findbycomm', [
                'entity_type' => strtoupper($entity), 'type' => 'PHONE', 'values' => [$phone],
            ]);
            if (! is_array($result)) {
                throw new RuntimeException('Invalid CRM search result.');
            }
            $ids = $result[strtoupper($entity)] ?? [];
            if (! is_array($ids) || array_filter($ids, fn ($id) => ! ctype_digit((string) $id) || (int) $id < 1)) {
                throw new RuntimeException('Invalid CRM identity.');
            }
            $ids = array_values(array_unique($ids));
            if (count($ids) > 1) {
                return ['reason' => 'ambiguous_'.$entity];
            }
            if (count($ids) === 1) {
                return ['entity' => $entity, 'id' => (string) $ids[0]];
            }
        }

        return ['reason' => 'record_not_found'];
    }

    public function samePhone(array $record, string $phone): bool
    {
        foreach ($record['PHONE'] ?? [] as $item) {
            if (preg_replace('/\D/', '', (string) ($item['VALUE'] ?? '')) === $phone) {
                return true;
            }
        }

        return false;
    }
}
