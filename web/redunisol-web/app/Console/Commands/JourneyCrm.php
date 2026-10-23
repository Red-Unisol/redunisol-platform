<?php

namespace App\Console\Commands;

use App\Services\EdnaBitrix;
use App\Services\JourneyLedger;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

class JourneyCrm extends Command
{
    protected $signature = 'journey:crm';

    protected $description = 'Copy incremental CRM snapshots, stage history and catalogs to the tracking volume';

    public function handle(JourneyLedger $ledger, EdnaBitrix $api): int
    {
        if (! config('journey.enabled') || ! config('journey.crm_enabled')) {
            return self::SUCCESS;
        }
        $directory = $ledger->directory();
        $lock = fopen($directory.'/crm.lock', 'c');
        if (! flock($lock, LOCK_EX | LOCK_NB)) {
            fclose($lock);

            return self::SUCCESS;
        }
        try {
            $stateFile = $directory.'/crm-cursors.json';
            $state = is_file($stateFile) ? json_decode(file_get_contents($stateFile), true, 32, JSON_THROW_ON_ERROR) : [];
            $deadline = microtime(true) + 45;
            foreach (['lead', 'contact', 'deal'] as $entity) {
                foreach ($entity === 'contact' ? ['snapshot'] : ['snapshot', 'stage'] as $kind) {
                    $key = $entity.'.'.$kind;
                    $cursor = $state[$key] ?? ['from' => config('journey.crm_since'), 'id' => 0];
                    $cursor['until'] ??= now()->subSeconds(30)->toIso8601String();
                    // A bounded window and ID keyset avoid moving offset pages and huge scans.
                    for ($page = 0; $page < 2 && microtime(true) < $deadline; $page++) {
                        $filter = ['>ID' => $cursor['id']];
                        if ($kind === 'snapshot') {
                            $filter += ['>=DATE_MODIFY' => $cursor['from'], '<=DATE_MODIFY' => $cursor['until']];
                            $items = $api->call('crm.'.$entity.'.list', ['order' => ['ID' => 'ASC'], 'filter' => $filter,
                                'select' => ['*', 'UF_*', 'PHONE', 'EMAIL'], 'start' => -1]);
                        } else {
                            $filter += ['>=CREATED_TIME' => $cursor['from'], '<=CREATED_TIME' => $cursor['until']];
                            $result = $api->call('crm.stagehistory.list', ['entityTypeId' => $entity === 'lead' ? 1 : 2,
                                'order' => ['ID' => 'ASC'], 'filter' => $filter, 'start' => -1]);
                            $items = $result['items'] ?? null;
                        }
                        if (! is_array($items) || ! array_is_list($items)) {
                            throw new \RuntimeException('Invalid CRM tracking page.');
                        }
                        $events = [];
                        foreach ($items as $item) {
                            if (! is_array($item) || ! ctype_digit((string) ($item['ID'] ?? '')) || (int) $item['ID'] <= $cursor['id']) {
                                throw new \RuntimeException('CRM tracking cursor did not advance.');
                            }
                            $cursor['id'] = (int) $item['ID'];
                            $links = [$entity.'_id' => (string) ($kind === 'stage' ? $item['OWNER_ID'] : $item['ID'])];
                            foreach (['CONTACT_ID' => 'contact_id', 'LEAD_ID' => 'lead_id', 'UF_CRM_JOURNEY_ID' => 'journey_id'] as $field => $link) {
                                if (! empty($item[$field])) {
                                    $links[$link] = (string) $item[$field];
                                }
                            }
                            $at = $item[$kind === 'stage' ? 'CREATED_TIME' : 'DATE_MODIFY'] ?? null;
                            if (! is_string($at) || strtotime($at) === false) {
                                throw new \RuntimeException('CRM tracking timestamp is invalid.');
                            }
                            $id = hash('sha256', $key.':'.json_encode($item, JSON_THROW_ON_ERROR));
                            $events[] = $ledger->event('crm.'.$kind, ['entity' => $entity, 'record' => $item], $links, 'bitrix', $id, $at);
                        }
                        // Journal first, cursor second. A crash can duplicate, never skip an acknowledged page.
                        $ledger->append($events, durable: true);
                        if (count($items) < 50) {
                            $cursor = ['from' => CarbonImmutable::parse($cursor['until'])->subMinutes(5)->toIso8601String(), 'id' => 0];
                        }
                        $state[$key] = $cursor;
                        $this->save($stateFile, $state);
                        if (count($items) < 50) {
                            break;
                        }
                        usleep(250000);
                    }
                }
            }
            if (($state['catalog_date'] ?? null) !== gmdate('Y-m-d') && microtime(true) < $deadline) {
                $events = [];
                foreach (['crm.lead.fields', 'crm.contact.fields', 'crm.deal.fields', 'crm.status.list'] as $method) {
                    if (microtime(true) >= $deadline) {
                        break;
                    }
                    $events[] = $ledger->event('crm.catalog', ['method' => $method, 'record' => $api->call($method)], [], 'bitrix',
                        hash('sha256', $method.':'.gmdate('Y-m-d')));
                }
                $ledger->append($events, durable: true);
                if (count($events) === 4) {
                    $state['catalog_date'] = gmdate('Y-m-d');
                }
                $this->save($stateFile, $state);
            }
            $this->line(json_encode(['ok' => true, 'cursors' => $state]));

            return self::SUCCESS;
        } catch (\Throwable) {
            // Never log HTTP exceptions, which may contain the webhook credential.
            $this->error('CRM tracking collection failed; saved cursors are retained.');

            return self::FAILURE;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function save(string $path, array $state): void
    {
        $temporary = $path.'.tmp';
        $payload = json_encode($state, JSON_THROW_ON_ERROR);
        $handle = fopen($temporary, 'wb');
        if (! $handle) {
            throw new \RuntimeException('CRM tracking checkpoint unavailable.');
        }
        try {
            if (fwrite($handle, $payload) !== strlen($payload) || ! fflush($handle) || ! fsync($handle)) {
                throw new \RuntimeException('CRM tracking checkpoint flush failed.');
            }
        } finally {
            fclose($handle);
        }
        if (! rename($temporary, $path)) {
            throw new \RuntimeException('CRM tracking checkpoint unavailable.');
        }
    }
}
