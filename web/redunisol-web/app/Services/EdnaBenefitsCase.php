<?php

namespace App\Services;

use RuntimeException;
use Throwable;

/** Native category-15 purpose only; never searches by phone or changes CRM. */
class EdnaBenefitsCase
{
    private EdnaBitrix $crm;

    private EdnaOrganicAttention $attention;

    public function __construct(?EdnaBitrix $crm = null, ?EdnaOrganicAttention $attention = null)
    {
        $this->crm = $crm ?? app(EdnaBitrix::class);
        $this->attention = $attention ?? new EdnaOrganicAttention($this->crm);
    }

    public function resolve(array $proof): array
    {
        return $this->resolveCase($proof, false);
    }

    /** Read-only decision for a new intake; also usable in observation. */
    public function resolveUnified(array $proof): array
    {
        return $this->resolveCase($proof, true);
    }

    private function resolveCase(array $proof, bool $unified): array
    {
        try {
            if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
                || ($proof['evidence'] ?? '') !== 'external_message_id') {
                throw new RuntimeException('An exact native proof is required.');
            }
            $this->id($proof['activity_id'] ?? null);
            $this->id($proof['message_id'] ?? null);
            $snapshot = $this->attention->snapshot($proof);
            $records = $this->records($snapshot);
            $tuple = $snapshot['dialog_tuple'];
            if ($this->id($proof['chat_id'] ?? null) !== $tuple['chat_id']
                || $this->id($proof['session_id'] ?? null) !== $tuple['session_id']) {
                throw new RuntimeException('Native session identity changed.');
            }
            $dealId = ($tuple['primary_entity'] ?? '') === 'deal' ? $this->id($tuple['primary_id'] ?? null) : null;
            $bound = $tuple['bindings']['deal'] ?? null;
            if ($dealId && $bound && $dealId !== $bound) {
                throw new RuntimeException('Native deal identity is ambiguous.');
            }
            $dealId ??= $bound;
            $deals = array_filter($records, fn ($record) => $record['entity'] === 'deal');
            if (count($deals) > 1 || (! $dealId && $deals !== [])) {
                throw new RuntimeException('Multiple or unrelated native deals.');
            }
            if (! $dealId) {
                return $this->result('not_applicable', 'native_benefits_case_absent', null, $snapshot);
            }
            $dealId = $this->id($dealId);
            $native = $records['deal:'.$dealId] ?? null;
            if (! $native || count($deals) !== 1) {
                throw new RuntimeException('Native deal record is unavailable.');
            }
            $this->relations($tuple, $records, $native, $unified);
            if (! is_string($native['category_id'] ?? null) || ! preg_match('/^(?:0|[1-9][0-9]*)$/D', $native['category_id'])) {
                throw new RuntimeException('Native deal category is incomplete.');
            }
            if ($native['category_id'] !== '15') {
                // A fresh native snapshot already proves this is another
                // pipeline. No Benefits routing permission is issued or cached;
                // the final outbound check resolves a new snapshot again.
                return $this->result('not_applicable', 'native_case_other_category', null, $snapshot);
            }
            $this->activity($proof, $tuple, $native);
            // Re-read the selected native deal after the snapshot. A changed
            // responsible/stage/contact cannot inherit its earlier eligibility.
            $raw = $this->crm->call('crm.deal.get', ['id' => $dealId]);
            $case = $this->case($raw);
            foreach (['deal_id' => 'id', 'category_id' => 'category_id', 'contact_id' => 'contact_id',
                'lead_id' => 'lead_id', 'responsible_id' => 'owner', 'stage' => 'stage', 'closed' => 'closed'] as $field => $key) {
                if ($case[$field] !== ($native[$key] ?? null)) {
                    throw new RuntimeException('Native deal changed during resolution.');
                }
            }
            if (($raw['STAGE_SEMANTIC_ID'] ?? null) !== ($native['stage_semantic'] ?? null)) {
                throw new RuntimeException('Native deal state changed during resolution.');
            }
            $semantic = $raw['STAGE_SEMANTIC_ID'] ?? null;
            if ($case['closed'] === 'Y' && in_array($semantic, ['S', 'F'], true)) {
                return $this->result('not_applicable', 'native_benefits_case_closed', null, $snapshot);
            }
            if ($case['closed'] !== 'N' || $semantic !== 'P'
                || ! preg_match('/^C15:[A-Za-z0-9_.:-]+$/D', $case['stage'])) {
                throw new RuntimeException('Native benefits case state is incomplete.');
            }

            $result = $this->result('benefits', 'native_active_benefits_case', $case, $snapshot);

            return $unified ? $result + ['routing_policy' => SalesChatRoutingPolicy::CUTOVER] : $result;
        } catch (Throwable) {
            // A provider error may carry a secret URL or personal information.
            return $this->result('review', 'native_benefits_case_unverified');
        }
    }

    /** Compare complete resolve results; no HTTP call or attention exception. */
    public function compatible(array $before, array $after, bool $afterTransfer = false): bool
    {
        try {
            $policy = $before['routing_policy'] ?? null;
            if ($policy !== ($after['routing_policy'] ?? null) || ! in_array($policy, [null, SalesChatRoutingPolicy::CUTOVER], true)) {
                return false;
            }
            $unified = $policy !== null;
            foreach ([$before, $after] as $result) {
                if (($result['status'] ?? '') !== 'benefits' || ! is_array($result['case'] ?? null)
                    || ! is_array($result['snapshot'] ?? null)) {
                    return false;
                }
                $records = $this->records($result['snapshot']);
                $case = $result['case'];
                $record = $records['deal:'.$this->id($case['deal_id'] ?? null)] ?? null;
                if (! $record || ($case['category_id'] ?? '') !== '15' || ($case['closed'] ?? '') !== 'N'
                    || ($record['stage_semantic'] ?? '') !== 'P'
                    || ! preg_match('/^C15:[A-Za-z0-9_.:-]+$/D', (string) ($case['stage'] ?? ''))) {
                    return false;
                }
                $this->id($case['responsible_id'] ?? null);
                foreach (['deal_id' => 'id', 'category_id' => 'category_id', 'contact_id' => 'contact_id',
                    'lead_id' => 'lead_id', 'responsible_id' => 'owner', 'stage' => 'stage', 'closed' => 'closed'] as $field => $key) {
                    if (($case[$field] ?? null) !== ($record[$key] ?? null)) {
                        return false;
                    }
                }
                $tuple = $result['snapshot']['dialog_tuple'];
                $nativeDeal = ($tuple['primary_entity'] ?? '') === 'deal' ? ($tuple['primary_id'] ?? '') : ($tuple['bindings']['deal'] ?? '');
                if (($result['chat_id'] ?? null) !== $tuple['chat_id'] || ($result['session_id'] ?? null) !== $tuple['session_id']
                    || $nativeDeal !== $case['deal_id']
                    || (($tuple['primary_entity'] ?? '') === 'deal' && $tuple['primary_id'] !== $case['deal_id'])
                    || (($tuple['bindings']['deal'] ?? $case['deal_id']) !== $case['deal_id'])) {
                    return false;
                }
                $this->relations($tuple, $records, $record, $unified);
            }
            if ($before['case'] !== $after['case'] || count($before['snapshot']['records']) !== count($after['snapshot']['records'])) {
                return false;
            }
            $expected = $before['snapshot'];
            if ($afterTransfer) {
                $target = $before['case']['responsible_id'];
                if (! in_array($expected['dialog_tuple']['owner'], ['', '0', '57', '74827', $target], true)
                    || $after['snapshot']['dialog_tuple']['owner'] !== $target) {
                    return false;
                }
                $expected['dialog_tuple']['owner'] = $target;
                foreach ($expected['records'] as $index => &$record) {
                    if ($unified || $record === $after['snapshot']['records'][$index]) {
                        continue;
                    }
                    if ($record['entity'] === 'lead' && $record['native'] === true
                        && ($after['snapshot']['records'][$index]['owner'] ?? null) === $target
                        && (in_array($record['owner'], ['', '0'], true)
                            || (in_array($record['owner'], ['57', '74827'], true) && $record['creator'] === $record['owner']))) {
                        $record['owner'] = $target;
                    }
                }
                unset($record);
                $expected['fingerprint'] = $this->fingerprint($expected);
            }

            return $expected === $after['snapshot'];
        } catch (Throwable) {
            return false;
        }
    }

    private function records(array $snapshot): array
    {
        if (($snapshot['version'] ?? null) !== 1 || ! is_array($snapshot['dialog_tuple'] ?? null)
            || ! is_array($snapshot['records'] ?? null) || ! array_is_list($snapshot['records'])
            || count($snapshot['records']) > 12 || ! is_string($snapshot['fingerprint'] ?? null)
            || ! hash_equals($this->fingerprint($snapshot), $snapshot['fingerprint'])) {
            throw new RuntimeException('Native snapshot is incomplete.');
        }
        $tuple = $snapshot['dialog_tuple'];
        foreach (['chat_id', 'session_id', 'session_epoch'] as $key) {
            if ($this->id($tuple[$key] ?? null) !== $tuple[$key]) {
                throw new RuntimeException('Native session identifiers are malformed.');
            }
        }
        if (! is_string($tuple['owner'] ?? null) || ! is_array($tuple['bindings'] ?? null)
            || ! preg_match('/^(?:|0|[1-9][0-9]{0,17})$/D', $tuple['owner'])
            || ! in_array($tuple['primary_entity'] ?? null, ['', 'lead', 'contact', 'company', 'deal'], true)
            || ! is_string($tuple['primary_id'] ?? null)
            || $this->optionalId($tuple['primary_id']) !== $tuple['primary_id']
            || (($tuple['primary_entity'] === '') !== ($tuple['primary_id'] === ''))
            || ! is_string($tuple['source_hash'] ?? null) || ! preg_match('/^[a-f0-9]{64}$/D', $tuple['source_hash'])) {
            throw new RuntimeException('Native tuple is incomplete.');
        }
        $records = [];
        foreach ($snapshot['records'] as $record) {
            if (! is_array($record) || ! in_array($record['entity'] ?? '', ['lead', 'contact', 'company', 'deal'], true)) {
                throw new RuntimeException('Native record is malformed.');
            }
            $key = $record['entity'].':'.$this->id($record['id'] ?? null);
            if (isset($records[$key])) {
                throw new RuntimeException('Native record is duplicated.');
            }
            if (! is_bool($record['native'] ?? null) || ($record['native'] && $record['entity'] !== 'lead')) {
                throw new RuntimeException('Native record role is incomplete.');
            }
            foreach (['owner', 'creator', 'contact_id', 'lead_id', 'company_id'] as $field) {
                if (! is_string($record[$field] ?? null) || $this->optionalId($record[$field]) !== $record[$field]) {
                    throw new RuntimeException('Native record identity is malformed.');
                }
            }
            foreach (['contact_ids', 'company_ids'] as $field) {
                if (! is_array($record[$field] ?? null) || ! array_is_list($record[$field]) || count($record[$field]) > 12) {
                    throw new RuntimeException('Native relationships are incomplete.');
                }
                foreach ($record[$field] as $id) {
                    if ($this->id($id) !== $id) {
                        throw new RuntimeException('Native relationship is malformed.');
                    }
                }
            }
            $records[$key] = $record;
        }
        $bindings = $tuple['bindings'];
        if ($tuple['primary_id'] !== '') {
            if (isset($bindings[$tuple['primary_entity']]) && $bindings[$tuple['primary_entity']] !== $tuple['primary_id']) {
                throw new RuntimeException('Native primary binding conflicts.');
            }
            $bindings[$tuple['primary_entity']] = $tuple['primary_id'];
        }
        foreach ($bindings as $entity => $id) {
            if (! in_array($entity, ['lead', 'contact', 'company', 'deal'], true) || $this->id($id) !== $id
                || ! isset($records[$entity.':'.$id])) {
                throw new RuntimeException('Native binding record is unavailable.');
            }
        }

        return $records;
    }

    private function activity(array $proof, array $tuple, array $deal): void
    {
        $activity = $this->crm->call('crm.activity.get', ['id' => $this->id($proof['activity_id'])]);
        $params = is_array($activity) ? ($activity['PROVIDER_PARAMS'] ?? null) : null;
        $params = is_string($params) ? json_decode($params, true, 16, JSON_THROW_ON_ERROR) : $params;
        $code = is_array($params) ? ($params['USER_CODE'] ?? null) : null;
        $key = (string) config('app.key');
        $owners = ['2' => $deal['id'], '1' => $deal['lead_id'], '3' => $deal['contact_id']];
        if (! is_array($activity) || (string) ($activity['ID'] ?? '') !== (string) $proof['activity_id']
            || ($activity['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
            || (string) ($activity['ASSOCIATED_ENTITY_ID'] ?? '') !== $tuple['session_id']
            || ! is_string($code) || $key === ''
            || ! hash_equals($tuple['source_hash'], hash_hmac('sha256', 'organic-source:'.$code, $key))
            || ! isset($owners[(string) ($activity['OWNER_TYPE_ID'] ?? '')])
            || $owners[(string) $activity['OWNER_TYPE_ID']] === ''
            || (string) ($activity['OWNER_ID'] ?? '') !== $owners[(string) $activity['OWNER_TYPE_ID']]) {
            throw new RuntimeException('Native session activity is unverified.');
        }
    }

    private function relations(array $tuple, array $records, array $deal, bool $unified = false): void
    {
        $ids = ['contact' => $deal['contact_id'] ?? '', 'lead' => $deal['lead_id'] ?? '', 'company' => $deal['company_id'] ?? ''];
        $chatOnly = $unified && $deal['category_id'] === '15';
        if ($ids['contact'] === '' && $ids['lead'] === '') {
            throw new RuntimeException('Native benefits person is unavailable.');
        }
        foreach ($ids as $entity => $id) {
            if ($id !== '' && ! isset($records[$entity.':'.$this->id($id)])) {
                throw new RuntimeException('Native benefits relationship is missing.');
            }
            $bound = $tuple['bindings'][$entity] ?? '';
            $primary = ($tuple['primary_entity'] ?? '') === $entity ? ($tuple['primary_id'] ?? '') : '';
            // records() already requires every binding to exist. Below we verify
            // the actual contact on each additional lead, including bound ones.
            if ($chatOnly && $entity === 'lead' && $ids['contact'] !== '') {
                continue;
            }
            if (($bound !== '' && $bound !== $id) || ($primary !== '' && $primary !== $id)) {
                throw new RuntimeException('Native benefits relationship conflicts.');
            }
        }
        $identities = [];
        foreach ($records as $record) {
            $relatedLead = $chatOnly && $record['entity'] === 'lead' && $ids['contact'] !== ''
                && $record['contact_id'] === $ids['contact'];
            if (in_array($record['entity'], ['lead', 'contact'], true)
                && $record['id'] !== $ids[$record['entity']] && ! $relatedLead) {
                throw new RuntimeException('Unrelated native person.');
            }
            if ($record['entity'] === 'lead' && ($record['contact_id'] ?? '') !== '' && $record['contact_id'] !== $ids['contact']) {
                throw new RuntimeException('Native lead/contact relationship conflicts.');
            }
            if (! $chatOnly && $deal['category_id'] === '15' && $record['entity'] === 'lead' && $record['owner'] !== $deal['owner']) {
                $provisional = $record['native'] === true && (in_array($record['owner'], ['', '0'], true)
                    || (in_array($record['owner'], ['57', '74827'], true) && $record['creator'] === $record['owner']));
                if (! $provisional) {
                    throw new RuntimeException('A manual lead responsible must be preserved.');
                }
            }
            if (! empty($record['identity_hash'])) {
                if (! is_string($record['identity_hash']) || ! preg_match('/^[a-f0-9]{64}$/D', $record['identity_hash'])) {
                    throw new RuntimeException('Native identity hash is malformed.');
                }
                $identities[$record['identity_hash']] = true;
            }
        }
        if (count($identities) > 1) {
            throw new RuntimeException('Native personal identities conflict.');
        }
    }

    private function case(mixed $raw): array
    {
        if (! is_array($raw) || ! array_key_exists('LEAD_ID', $raw) || ! array_key_exists('CONTACT_ID', $raw)
            || ! is_string($raw['STAGE_ID'] ?? null) || $raw['STAGE_ID'] === ''
            || ! in_array($raw['CLOSED'] ?? null, ['N', 'Y'], true)) {
            throw new RuntimeException('Native deal fields are incomplete.');
        }
        $category = $raw['CATEGORY_ID'] ?? null;
        if ((! is_string($category) && ! is_int($category)) || ! preg_match('/^(?:0|[1-9][0-9]*)$/D', (string) $category)) {
            throw new RuntimeException('Native deal category is incomplete.');
        }

        return ['deal_id' => $this->id($raw['ID'] ?? null), 'category_id' => (string) $category,
            'contact_id' => $this->optionalId($raw['CONTACT_ID']), 'lead_id' => $this->optionalId($raw['LEAD_ID']),
            'responsible_id' => $this->id($raw['ASSIGNED_BY_ID'] ?? null), 'stage' => $raw['STAGE_ID'], 'closed' => $raw['CLOSED']];
    }

    private function optionalId(mixed $value): string
    {
        return in_array($value, [null, '', '0', 0], true) ? '' : $this->id($value);
    }

    private function id(mixed $value): string
    {
        if ((! is_string($value) && ! is_int($value)) || ! preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value)) {
            throw new RuntimeException('Invalid native identifier.');
        }

        return (string) $value;
    }

    private function fingerprint(array $snapshot): string
    {
        return hash('sha256', json_encode(['version' => $snapshot['version'], 'dialog_tuple' => $snapshot['dialog_tuple'],
            'records' => $snapshot['records']], JSON_THROW_ON_ERROR));
    }

    private function result(string $status, string $reason, ?array $case = null, ?array $snapshot = null): array
    {
        return ['status' => $status, 'reason' => $reason, 'case' => $case, 'snapshot' => $snapshot,
            'chat_id' => $snapshot['dialog_tuple']['chat_id'] ?? null, 'session_id' => $snapshot['dialog_tuple']['session_id'] ?? null];
    }
}
