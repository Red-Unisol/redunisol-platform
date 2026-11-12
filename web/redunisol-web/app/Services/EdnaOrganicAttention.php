<?php

namespace App\Services;

use RuntimeException;
use Throwable;

/** Read-only attention and CRM ownership checks; never accepts or transfers a chat. */
class EdnaOrganicAttention
{
    private EdnaBitrix $crm;

    private WebFormChatGuard $guard;

    private int $calls = 0;

    private float $deadline = 0;

    public function __construct(?EdnaBitrix $crm = null, ?WebFormChatGuard $guard = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
        $this->guard = $guard ?? new WebFormChatGuard($this->crm);
    }

    public function inspect(array $proof, int $targetId): array
    {
        $result = $this->guard->inspect($proof, (string) $targetId);
        $result['native_snapshot'] = null;
        if (! in_array($result['status'] ?? '', ['ready', 'already_assigned'], true)) {
            return $result;
        }
        try {
            $snapshot = $this->snapshot($proof);
            if ($this->dialogTuple($result['dialog'] ?? null, $proof) !== $snapshot['dialog_tuple']) {
                return array_replace($result, ['status' => 'preserved', 'reason' => 'native_dialog_changed']);
            }
            $result['native_snapshot'] = $snapshot;
        } catch (Throwable) {
            return array_replace($result, ['status' => 'waiting', 'reason' => 'native_crm_snapshot_unavailable']);
        }

        return $result;
    }

    /** Greeting eligibility uses live chat attention, not the CRM's commercial owner. */
    public function inspectWelcome(array $proof): array
    {
        $result = $this->guard->inspect($proof, '5737');
        if (($result['status'] ?? '') === 'already_assigned') {
            return array_replace($result, ['status' => 'preserved', 'reason' => 'chat_owner_preserved']);
        }

        return $result;
    }

    /** Only technical IDs, enum values and keyed identity hashes leave this method. */
    public function snapshot(array $proof): array
    {
        $this->beginReads();
        try {
            $tuple = $this->dialogTuple($this->read('imopenlines.dialog.get', ['CHAT_ID' => $this->id($proof['chat_id'] ?? null)]), $proof);
            $bindings = $tuple['bindings'];
            if ($tuple['primary_id'] !== '') {
                $bindings[$tuple['primary_entity']] = $tuple['primary_id'];
            }
            $nativeLead = $proof['native_lead_id'] ?? ($tuple['primary_entity'] === 'lead' ? $tuple['primary_id'] : null);
            if ($nativeLead !== null && $nativeLead !== '') {
                $nativeLead = $this->id($nativeLead);
                if (($bindings['lead'] ?? null) !== $nativeLead) {
                    throw new RuntimeException('Native lead identity is inconsistent.');
                }
            }
            $pending = [];
            foreach ($bindings as $entity => $id) {
                $pending[$entity.':'.$id] = $id;
            }
            $records = [];
            while ($pending !== []) {
                $key = array_key_first($pending);
                $id = $pending[$key];
                unset($pending[$key]);
                [$entity] = explode(':', $key, 2);
                if (isset($records[$key])) {
                    continue;
                }
                if (count($records) >= 12) {
                    throw new RuntimeException('CRM relationship budget exceeded.');
                }
                $record = $this->record($entity, $id, $this->read('crm.'.$entity.'.get', ['id' => $id]), $entity === 'lead' && $id === $nativeLead);
                $records[$key] = $record;
                foreach (['contact' => array_unique(array_merge([$record['contact_id']], $record['contact_ids'])),
                    'company' => array_unique(array_merge([$record['company_id']], $record['company_ids'])),
                    'lead' => [$record['lead_id']]] as $related => $ids) {
                    foreach ($ids as $relatedId) {
                        if ($relatedId !== '' && ! isset($records[$related.':'.$relatedId])) {
                            // Multiple related records are queued by their full identity, never by an arbitrary winner.
                            $pending[$related.':'.$relatedId] = $relatedId;
                        }
                    }
                }
            }
            ksort($records, SORT_STRING);
            $last = $this->dialogTuple($this->read('imopenlines.dialog.get', ['CHAT_ID' => $tuple['chat_id']]), $proof);
            if ($last !== $tuple) {
                throw new RuntimeException('Native dialog changed during inspection.');
            }
            $snapshot = ['version' => 1, 'dialog_tuple' => $tuple, 'records' => array_values($records)];
            $snapshot['fingerprint'] = $this->fingerprint($snapshot);

            return $snapshot;
        } catch (Throwable) {
            // HTTP failures can include a credential or customer data; never retain their message or cause.
            throw new RuntimeException('Organic CRM snapshot unavailable.');
        }
    }

    public function canTransfer(array $snapshot, int $targetId): bool
    {
        if ($targetId < 1 || ! $this->validSnapshot($snapshot)
            || ! in_array($snapshot['dialog_tuple']['owner'], ['', '0', '57', '74827', (string) $targetId], true)) {
            return false;
        }
        foreach ($snapshot['records'] as $record) {
            if (! in_array($record['owner'], ['', '0', (string) $targetId], true) && ! $this->provisionalLead($record)) {
                return false;
            }
        }

        return true;
    }

    public function targetActive(int $targetId): bool
    {
        if ($targetId < 1) {
            return false;
        }
        $this->beginReads();
        try {
            $rows = $this->read('user.get', ['FILTER' => ['ID' => (string) $targetId]]);
            if (! is_array($rows) || ! array_is_list($rows) || count($rows) !== 1) {
                return false;
            }
            $user = $rows[0];
            if (! is_array($user) || $this->id($user['ID'] ?? null) !== (string) $targetId
                || ! in_array($user['ACTIVE'] ?? null, [true, 'Y', 1, '1'], true)
                || (isset($user['USER_TYPE']) && $user['USER_TYPE'] !== 'employee')
                || in_array($user['EXTERNAL_AUTH_ID'] ?? '', ['bot', 'imconnector', 'email', 'replica', 'crm'], true)
                || ! is_array($user['UF_DEPARTMENT'] ?? null) || $user['UF_DEPARTMENT'] === []) {
                return false;
            }
            foreach ($user['UF_DEPARTMENT'] as $department) {
                $this->id($department);
            }

            return true;
        } catch (Throwable) {
            return false;
        }
    }

    public function compatible(array $before, array $after, int $targetId, bool $afterTransfer = false): bool
    {
        if (! $this->canTransfer($before, $targetId) || ! $this->validSnapshot($after)) {
            return false;
        }
        if (! $afterTransfer) {
            return hash_equals($before['fingerprint'], $after['fingerprint']);
        }
        if ($after['dialog_tuple']['owner'] !== (string) $targetId) {
            return false;
        }
        $expectedTuple = $before['dialog_tuple'];
        $expectedTuple['owner'] = (string) $targetId;
        if ($expectedTuple !== $after['dialog_tuple'] || count($before['records']) !== count($after['records'])) {
            return false;
        }
        foreach ($before['records'] as $index => $record) {
            $current = $after['records'][$index];
            if ($record === $current) {
                continue;
            }
            if (! $this->provisionalLead($record) || $current['owner'] !== (string) $targetId) {
                return false;
            }
            $record['owner'] = (string) $targetId;
            if ($record !== $current) {
                return false;
            }
        }

        return true;
    }

    private function dialogTuple(mixed $dialog, array $proof): array
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || ! is_array($dialog)
            || $this->id($dialog['id'] ?? null) !== $this->id($proof['chat_id'] ?? null)
            || ($dialog['entity_type'] ?? '') !== 'LINES' || ! array_key_exists('owner', $dialog) || $dialog['owner'] === null) {
            throw new RuntimeException('Invalid native dialog proof.');
        }
        $source = explode('|', (string) ($dialog['entity_id'] ?? ''));
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        $subject = (string) config('edna.subject_id');
        if (! preg_match('/^[0-9]{1,64}$/D', $subject) || count($source) !== 4 || $source[0] !== 'whatsappbyedna' || $source[1] !== '1'
            || ! preg_match('/^[0-9]{10,15}@'.preg_quote($subject, '/').'$/D', $source[2])
            || count($parts) < 7 || $this->id($parts[5]) !== $this->id($proof['session_id'] ?? null)
            || ! in_array($dialog['text_field_enabled'] ?? null, [true, 'Y', 1, '1'], true)) {
            throw new RuntimeException('Native session was replaced or is unavailable.');
        }
        $this->id($source[3]);
        $this->id($parts[6]);
        $bindings = [];
        $raw = (string) ($dialog['entity_data_2'] ?? '');
        $pairs = $raw === '' ? [] : explode('|', $raw);
        if (count($pairs) % 2 !== 0 || count($pairs) > 8) {
            throw new RuntimeException('CRM bindings are incomplete.');
        }
        $seen = [];
        for ($i = 0; $i < count($pairs); $i += 2) {
            $entity = strtolower($pairs[$i]);
            if (! in_array($entity, ['lead', 'contact', 'deal', 'company'], true) || isset($seen[$entity])) {
                throw new RuntimeException('Ambiguous native CRM bindings.');
            }
            $seen[$entity] = true;
            $id = $this->optionalId($pairs[$i + 1]);
            if ($id !== '') {
                $bindings[$entity] = $id;
            }
        }
        $primaryEntity = strtolower($parts[1]);
        $primaryId = $this->optionalId($parts[2]);
        if ($primaryId !== '' && (! in_array($primaryEntity, ['lead', 'contact', 'deal', 'company'], true)
            || (isset($bindings[$primaryEntity]) && $bindings[$primaryEntity] !== $primaryId))) {
            throw new RuntimeException('Native primary CRM identity conflicts.');
        }
        if ($primaryId === '') {
            $primaryEntity = '';
        }
        ksort($bindings, SORT_STRING);

        return ['chat_id' => $this->id($dialog['id']), 'session_id' => $this->id($parts[5]),
            'source_hash' => $this->keyedHash('organic-source:', (string) $dialog['entity_id']),
            'session_epoch' => $parts[6], 'owner' => $this->optionalId($dialog['owner'] ?? null),
            'primary_entity' => $primaryEntity, 'primary_id' => $primaryId, 'bindings' => $bindings];
    }

    private function record(string $entity, string $id, mixed $body, bool $native): array
    {
        if (! in_array($entity, ['lead', 'contact', 'deal', 'company'], true) || ! is_array($body)
            || $this->id($body['ID'] ?? null) !== $id || ! array_key_exists('ASSIGNED_BY_ID', $body) || $body['ASSIGNED_BY_ID'] === null) {
            throw new RuntimeException('CRM record identity is unavailable.');
        }
        $identity = $entity === 'lead' ? ($body['UF_CRM_1693840106704'] ?? '')
            : ($entity === 'contact' ? ($body['UF_CRM_65B7E48033FCD'] ?? '') : '');
        if (! is_string($identity)) {
            throw new RuntimeException('CRM identity field is malformed.');
        }
        $digits = preg_replace('/\D/', '', $identity);
        $identityHash = $identity === '' ? null : (preg_match('/^[0-9]{11}$/D', $digits)
            ? $this->keyedHash('web-form-identity:', $digits) : $this->keyedHash('organic-invalid-identity:', $identity));

        return ['entity' => $entity, 'id' => $id, 'native' => $native,
            'owner' => $this->optionalId($body['ASSIGNED_BY_ID']), 'creator' => $this->optionalId($body['CREATED_BY_ID'] ?? ''),
            'contact_id' => $this->optionalId($body['CONTACT_ID'] ?? ''), 'lead_id' => $this->optionalId($body['LEAD_ID'] ?? ''),
            'company_id' => $this->optionalId($body['COMPANY_ID'] ?? ''),
            'contact_ids' => $this->idList($body['CONTACT_IDS'] ?? []), 'company_ids' => $this->idList($body['COMPANY_IDS'] ?? []),
            'stage' => $this->enum($body['STAGE_ID'] ?? ''), 'status' => $this->enum($body['STATUS_ID'] ?? ''),
            'stage_semantic' => $this->enum($body['STAGE_SEMANTIC_ID'] ?? ''), 'status_semantic' => $this->enum($body['STATUS_SEMANTIC_ID'] ?? ''),
            'category_id' => $this->enum($body['CATEGORY_ID'] ?? ''), 'closed' => $this->enum($body['CLOSED'] ?? ''),
            'identity_hash' => $identityHash];
    }

    private function provisionalLead(array $record): bool
    {
        return $record['entity'] === 'lead' && $record['native'] === true
            && (in_array($record['owner'], ['', '0'], true)
                || (in_array($record['owner'], ['57', '74827'], true) && $record['creator'] === $record['owner']));
    }

    private function validSnapshot(array $snapshot): bool
    {
        try {
            if (($snapshot['version'] ?? null) !== 1 || ! is_array($snapshot['dialog_tuple'] ?? null)
                || ! is_array($snapshot['records'] ?? null) || ! array_is_list($snapshot['records'])
                || count($snapshot['records']) > 12
                || ! is_string($snapshot['fingerprint'] ?? null) || ! preg_match('/^[a-f0-9]{64}$/D', $snapshot['fingerprint'])) {
                return false;
            }
            $tuple = $snapshot['dialog_tuple'];
            foreach (['chat_id', 'session_id', 'session_epoch'] as $field) {
                $this->id($tuple[$field] ?? null);
            }
            if (! is_string($tuple['owner'] ?? null) || ! is_string($tuple['source_hash'] ?? null)
                || ! preg_match('/^[a-f0-9]{64}$/D', $tuple['source_hash']) || ! is_array($tuple['bindings'] ?? null)) {
                return false;
            }
            $this->optionalId($tuple['owner']);
            $seen = [];
            foreach ($snapshot['records'] as $record) {
                if (! is_array($record) || ! in_array($record['entity'] ?? '', ['lead', 'contact', 'deal', 'company'], true)
                    || ! is_bool($record['native'] ?? null) || ! is_string($record['owner'] ?? null)
                    || ! is_string($record['creator'] ?? null)) {
                    return false;
                }
                $id = $this->id($record['id'] ?? null);
                $key = $record['entity'].':'.$id;
                if (isset($seen[$key]) || ($record['native'] && $record['entity'] !== 'lead')) {
                    return false;
                }
                $seen[$key] = true;
                foreach (['owner', 'creator', 'contact_id', 'lead_id', 'company_id'] as $field) {
                    if (! array_key_exists($field, $record) || ! is_string($record[$field])) {
                        return false;
                    }
                    $this->optionalId($record[$field]);
                }
            }

            return hash_equals($snapshot['fingerprint'], $this->fingerprint($snapshot));
        } catch (Throwable) {
            return false;
        }
    }

    private function fingerprint(array $snapshot): string
    {
        return hash('sha256', json_encode(['version' => $snapshot['version'], 'dialog_tuple' => $snapshot['dialog_tuple'], 'records' => $snapshot['records']], JSON_THROW_ON_ERROR));
    }

    private function optionalId(mixed $value): string
    {
        if ($value === '' || $value === '0' || $value === 0 || $value === null) {
            return '';
        }

        return $this->id($value);
    }

    private function id(mixed $value): string
    {
        if ((! is_int($value) && ! is_string($value)) || ! preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value)) {
            throw new RuntimeException('Invalid technical identifier.');
        }

        return (string) $value;
    }

    private function idList(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) > 12) {
            throw new RuntimeException('CRM relationships are incomplete.');
        }
        $ids = array_values(array_unique(array_map(fn ($id) => $this->id($id), $value)));
        sort($ids, SORT_STRING);

        return $ids;
    }

    private function enum(mixed $value): string
    {
        if ((! is_string($value) && ! is_int($value)) || ! preg_match('/^[A-Za-z0-9_:.-]{0,80}$/D', (string) $value)) {
            throw new RuntimeException('CRM state is malformed.');
        }

        return (string) $value;
    }

    private function keyedHash(string $domain, string $value): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new RuntimeException('Snapshot identity key is unavailable.');
        }

        return hash_hmac('sha256', $domain.$value, $key);
    }

    private function beginReads(): void
    {
        $this->calls = 0;
        $this->deadline = microtime(true) + 25;
    }

    private function read(string $method, array $payload): mixed
    {
        if (++$this->calls > 16 || microtime(true) >= $this->deadline
            || ! in_array($method, ['imopenlines.dialog.get', 'crm.lead.get', 'crm.contact.get', 'crm.deal.get', 'crm.company.get', 'user.get'], true)) {
            throw new RuntimeException('Organic attention read budget exceeded.');
        }

        return $this->crm->call($method, $payload);
    }
}
