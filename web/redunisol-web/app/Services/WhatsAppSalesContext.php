<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use RuntimeException;

class WhatsAppSalesContext
{
    private EdnaBitrix $crm;

    private float $deadline;

    private array $users = [];

    public function resolve(string $phone, array $requirements): array
    {
        $this->crm = new EdnaBitrix;
        $this->deadline = microtime(true) + 45;
        $this->users = [];
        $formSince = CarbonImmutable::parse($requirements['form_since']);
        $advisorSince = CarbonImmutable::parse($requirements['advisor_since']);
        $categories = array_map('intval', $requirements['deal_categories']);
        $hash = (new AttributionJourney)->phoneHash($phone);
        if (! $hash) {
            throw new RuntimeException('Unsupported sales identity.');
        }
        $records = ['contact' => [], 'lead' => []];
        foreach (array_keys($records) as $entity) {
            $matches = $this->call('crm.duplicate.findbycomm', [
                'entity_type' => strtoupper($entity), 'type' => 'PHONE', 'values' => [$phone],
            ]);
            if (! is_array($matches) || ! is_array($matches[strtoupper($entity)] ?? [])) {
                throw new RuntimeException('Invalid CRM identity response.');
            }
            $ids = array_values(array_unique(array_map('strval', $matches[strtoupper($entity)] ?? [])));
            if (count($ids) > ($entity === 'lead' ? 1000 : 10)) {
                throw new RuntimeException('Sales identity requires manual review.');
            }
            $rows = $entity === 'lead' ? $this->leadRecords($ids)
                : array_map(fn ($id) => $this->call('crm.contact.get', ['id' => $id]), $ids);
            foreach ($rows as $record) {
                if (collect($record['PHONE'] ?? [])->contains(fn ($p) => (new AttributionJourney)->phoneHash((string) ($p['VALUE'] ?? '')) === $hash)) {
                    $records[$entity][(string) $record['ID']] = $record;
                }
            }
        }
        $contacts = array_map('strval', array_keys($records['contact']));
        $leadIds = array_map('strval', array_keys($records['lead']));
        $identity = count($contacts) === 1 ? array_values($records['contact'])[0]
            : (! $contacts && count($leadIds) === 1 ? array_values($records['lead'])[0] : null);
        $base = ['evidence' => [], 'name' => $identity ? $this->safeName($identity['NAME'] ?? '') : null,
            'entity' => $identity ? ($contacts ? 'contact' : 'lead') : null, 'id' => $identity['ID'] ?? null];
        $deals = [];
        // This portal ignores nested OR groups in crm.deal.list. Query each binding
        // separately and validate the returned ownership before using it.
        foreach (['CONTACT_ID' => $contacts, 'LEAD_ID' => $leadIds] as $field => $ids) {
            if (! $ids) {
                continue;
            }
            $rows = $this->list('crm.deal.list', [
                '@CATEGORY_ID' => $categories, '=STAGE_SEMANTIC_ID' => 'P', '@'.$field => $ids,
            ], ['ID', 'ASSIGNED_BY_ID', 'CONTACT_ID', 'LEAD_ID', 'CATEGORY_ID', 'STAGE_SEMANTIC_ID']);
            foreach ($rows as $deal) {
                if (! in_array((string) ($deal[$field] ?? ''), array_map('strval', $ids), true)
                    || ! in_array((int) ($deal['CATEGORY_ID'] ?? -1), $categories, true) || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P') {
                    throw new RuntimeException('CRM deal ownership does not match the requested Sales identity.');
                }
                $deals[(string) $deal['ID']] = $deal;
            }
        }
        if ($deals) {
            return $this->withEvidence($base, $deals, $identity !== null, 'open_deal');
        }
        $leads = $records['lead'];
        if ($contacts) {
            foreach ($this->list('crm.lead.list', ['@CONTACT_ID' => $contacts, '>=DATE_CREATE' => $formSince->toIso8601String()], ['*']) as $lead) {
                if (! in_array((string) ($lead['CONTACT_ID'] ?? ''), array_map('strval', $contacts), true)) {
                    throw new RuntimeException('CRM lead ownership does not match the requested Sales identity.');
                }
                $leads[(string) $lead['ID']] = $lead;
            }
        }
        $anyFormSince = isset($requirements['any_form_since']) ? CarbonImmutable::parse($requirements['any_form_since']) : null;
        $forms = array_filter($leads, fn ($lead) => $this->isForm($lead)
            && ((($lead['STATUS_SEMANTIC_ID'] ?? '') !== 'F' && CarbonImmutable::parse($lead['DATE_CREATE'])->gte($formSince))
                || ($anyFormSince && CarbonImmutable::parse($lead['DATE_CREATE'])->gte($anyFormSince))));
        if ($forms) {
            return $this->withEvidence($base, $forms, $identity !== null, 'form');
        }
        $seen = [];
        foreach ($records as $entity => $items) {
            foreach ($items as $id => $record) {
                $chats = $this->call('imopenlines.crm.chat.get', ['CRM_ENTITY_TYPE' => $entity, 'CRM_ENTITY' => $id, 'ACTIVE_ONLY' => 'N']);
                foreach ($chats as $chat) {
                    $chatId = (int) $chat['CHAT_ID'];
                    if (isset($seen[$chatId])) {
                        continue;
                    }
                    $seen[$chatId] = true;
                    $dialog = $this->call('im.dialog.get', ['DIALOG_ID' => 'chat'.$chatId]);
                    // Only the authenticated Ventas WhatsApp channel; other lines are out of scope.
                    $parts = explode('|', (string) ($dialog['entity_id'] ?? ''));
                    if (count($parts) < 2 || $parts[0] !== 'whatsappbyedna' || $parts[1] !== '1') {
                        continue;
                    }
                    $advisor = $this->recentAdvisor($chatId, $advisorSince);
                    if ($advisor) {
                        return $this->withEvidence($base, [$advisor], $identity !== null, 'advisor_message');
                    }
                }
            }
        }

        return $base;
    }

    private function leadRecords(array $ids): array
    {
        $records = [];
        // The list endpoint returns at most 50 rows. Fetch every requested record
        // in bounded batches instead of spending one HTTP request per old lead.
        foreach (array_chunk($ids, 50) as $batch) {
            $rows = $this->call('crm.lead.list', ['filter' => ['@ID' => $batch],
                'select' => ['*', 'UF_*', 'PHONE'], 'order' => ['ID' => 'ASC'], 'start' => -1]);
            if (! is_array($rows) || ! array_is_list($rows)) {
                throw new RuntimeException('Invalid CRM identity response.');
            }
            $found = [];
            foreach ($rows as $record) {
                $id = (string) ($record['ID'] ?? '');
                if (! in_array($id, $batch, true) || isset($found[$id])) {
                    throw new RuntimeException('CRM lead identity does not match the requested records.');
                }
                $found[$id] = $record;
            }
            if (count($found) !== count($batch)) {
                throw new RuntimeException('CRM lead identity response is incomplete.');
            }
            $records = array_merge($records, array_values($found));
        }

        return $records;
    }

    private function isForm(array $lead): bool
    {
        // Markers written by the existing web intake, including pre-attribution submissions.
        // Router/assisted leads also receive ATTR_JSON. Attribution alone is not a form.
        return ! empty($lead['UF_CRM_COMM_OWNER'])
            && ! empty($lead['UF_CRM_1693840106704']) && ! empty($lead['UF_CRM_1714071903'])
            && ! empty($lead['UF_CRM_64E65D2B2136C'])
            && (! empty($lead['UF_CRM_ATTR_JSON']) || ($lead['UF_CRM_1722365051'] ?? '') !== '3729');
    }

    private function withEvidence(array $base, array $records, bool $personalize, string $kind): array
    {
        $base['evidence'] = array_values(array_map(fn ($record) => match ($kind) {
            'open_deal' => ['kind' => $kind, 'category_id' => (int) $record['CATEGORY_ID']],
            'form' => ['kind' => $kind, 'observed_at' => $record['DATE_CREATE'], 'status_semantic' => $record['STATUS_SEMANTIC_ID'] ?? ''],
            'advisor_message' => ['kind' => $kind, 'observed_at' => $record['OBSERVED_AT'], 'verified_human' => true],
        }, $records));
        $ids = array_values(array_unique(array_filter(array_column(array_values($records), 'ASSIGNED_BY_ID'))));
        if (count($ids) === 1) {
            $user = $this->employee((int) $ids[0]);
            if ($user) {
                $base['advisor_id'] = (int) $ids[0];
                if ($personalize) {
                    $base['advisor_name'] = $this->safeName($user['NAME'] ?? '');
                }
            }
        }

        return $base;
    }

    private function recentAdvisor(int $chatId, CarbonImmutable $cutoff): ?array
    {
        $last = null;
        for ($page = 0; $page < 20; $page++) {
            $params = ['DIALOG_ID' => 'chat'.$chatId, 'LIMIT' => 50];
            if ($last) {
                $params['LAST_ID'] = $last;
            }
            $result = $this->call('im.dialog.messages.get', $params);
            if ((int) ($result['chat_id'] ?? 0) !== $chatId || ! is_array($result['messages'] ?? null)) {
                throw new RuntimeException('Invalid sales chat history.');
            }
            $messages = $result['messages'];
            $oldest = null;
            foreach ($messages as $message) {
                $date = CarbonImmutable::parse($message['date']);
                $oldest = ! $oldest || $date->lt($oldest) ? $date : $oldest;
                if ($date->lt($cutoff) || empty($message['author_id']) || empty($message['text'])
                    || ! empty($message['params']['IS_SYSTEM']) || ! empty($message['params']['BOT_ID'])) {
                    continue;
                }
                foreach ($result['users'] ?? [] as $user) {
                    if ((int) ($user['id'] ?? 0) === (int) $message['author_id'] && ! empty($user['bot'])) {
                        continue 2;
                    }
                }
                if ($this->employee((int) $message['author_id'])) {
                    return ['ASSIGNED_BY_ID' => (int) $message['author_id'], 'OBSERVED_AT' => $date->toIso8601String()];
                }
            }
            if (count($messages) < 50 || ($oldest && $oldest->lt($cutoff))) {
                return null;
            }
            $next = min(array_column($messages, 'id'));
            if ($last && $next >= $last) {
                throw new RuntimeException('Sales history pagination did not progress.');
            }
            $last = $next;
        }
        throw new RuntimeException('Sales history requires manual review.');
    }

    private function employee(int $id): ?array
    {
        if (! array_key_exists($id, $this->users)) {
            $rows = $this->call('user.get', ['ID' => $id]);
            $user = count($rows) === 1 ? $rows[0] : null;
            $this->users[$id] = $user && (int) $user['ID'] === $id && ! empty($user['UF_DEPARTMENT'])
                && in_array($user['ACTIVE'] ?? null, [true, 'Y', 1, '1'], true)
                && ! in_array($user['EXTERNAL_AUTH_ID'] ?? '', ['bot', 'imconnector'], true) ? $user : null;
        }

        return $this->users[$id];
    }

    private function list(string $method, array $filter, array $select): array
    {
        $records = [];
        $cursor = 0;
        for ($page = 0; $page < 20; $page++) {
            $rows = $this->call($method, ['filter' => $filter + ['>ID' => $cursor], 'select' => $select,
                'order' => ['ID' => 'ASC'], 'start' => -1]);
            if (! is_array($rows) || ! array_is_list($rows)) {
                throw new RuntimeException('Invalid CRM list.');
            }
            $records = array_merge($records, $rows);
            if (count($rows) < 50) {
                return $records;
            }
            $next = (int) max(array_column($rows, 'ID'));
            if ($next <= $cursor) {
                throw new RuntimeException('CRM pagination did not progress.');
            }
            $cursor = $next;
        }
        throw new RuntimeException('CRM identity requires manual review.');
    }

    private function call(string $method, array $params): mixed
    {
        if (microtime(true) >= $this->deadline) {
            throw new RuntimeException('Sales context time budget exceeded.');
        }

        return $this->crm->call($method, $params);
    }

    private function safeName(string $name): ?string
    {
        $name = trim($name);

        return $name !== '' && mb_strlen($name) <= 80 && preg_match('/^[\p{L}\p{M}\s\x{0027}-]+$/u', $name) ? $name : null;
    }
}
