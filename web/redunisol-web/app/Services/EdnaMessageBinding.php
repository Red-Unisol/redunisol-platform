<?php

namespace App\Services;

use Illuminate\Support\Facades\Crypt;
use RuntimeException;
use Throwable;

/** Locates an authenticated incoming Edna message without changing its CRM ownership. */
class EdnaMessageBinding
{
    private const ACTIVITY_FIELDS = ['ID', 'OWNER_ID', 'OWNER_TYPE_ID', 'PROVIDER_ID', 'ASSOCIATED_ENTITY_ID', 'PROVIDER_PARAMS'];

    private EdnaBitrix $crm;

    private float $deadline;

    private float $lastCall = 0;

    private int $calls = 0;

    public function __construct(?EdnaBitrix $crm = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
    }

    /** The phone discovers candidates; only the exact native connector message proves a binding. */
    public function resolve(object $event, array $payload, ?int $knownChatId = null): ?array
    {
        $this->deadline = microtime(true) + 30;
        $this->calls = 0;
        $phoneHash = $this->entryPhone($event, $payload);
        if ($knownChatId !== null && $knownChatId < 1) {
            throw new RuntimeException('Invalid known message chat.');
        }

        if ($knownChatId !== null) {
            return $this->knownChat($event, $phoneHash, $knownChatId);
        }

        $phone = (string) $payload['subscriber']['identifier'];
        $candidates = [];
        foreach (['LEAD' => 1, 'CONTACT' => 3] as $entity => $type) {
            $result = $this->call('crm.duplicate.findbycomm', ['entity_type' => $entity, 'type' => 'PHONE', 'values' => [$phone]]);
            if (! is_array($result)) {
                throw new RuntimeException('Invalid message candidate response.');
            }
            $ids = $result[$entity] ?? [];
            if (! is_array($ids) || ! array_is_list($ids)) {
                throw new RuntimeException('Invalid message candidate identifiers.');
            }
            foreach ($ids as $id) {
                if (! $this->positiveId($id)) {
                    throw new RuntimeException('Invalid message candidate identifier.');
                }
                $candidates[$type.':'.$id] = ['type' => $type, 'id' => (string) $id, 'entity' => strtolower($entity)];
            }
            if (count($candidates) > 100) {
                throw new RuntimeException('Message candidate window requires review.');
            }
        }

        $activities = [];
        foreach (['lead' => 1, 'contact' => 3] as $entity => $type) {
            $ids = array_column(array_filter($candidates, fn ($candidate) => $candidate['type'] === $type), 'id');
            foreach (array_chunk($ids, 50) as $batch) {
                $records = $this->call('crm.'.$entity.'.list', ['filter' => ['@ID' => $batch], 'select' => ['ID', 'PHONE'], 'start' => -1]);
                if (! is_array($records) || ! array_is_list($records)) {
                    throw new RuntimeException('Invalid message candidate records.');
                }
                $returned = array_map(fn ($record) => (string) ($record['ID'] ?? ''), $records);
                $expected = $batch;
                sort($returned);
                sort($expected);
                if ($returned !== $expected) {
                    throw new RuntimeException('Message candidate response is incomplete.');
                }
                foreach ($records as $record) {
                    $phones = $record['PHONE'] ?? [];
                    if (! is_array($phones) || ! collect($phones)->contains(fn ($value) => is_array($value)
                        && (new AttributionJourney)->phoneHash((string) ($value['VALUE'] ?? '')) === $phoneHash)) {
                        throw new RuntimeException('Message candidate does not match the sender.');
                    }
                    foreach ($this->activities(['OWNER_TYPE_ID' => $type, 'OWNER_ID' => $record['ID']]) as $activity) {
                        $this->addActivity($activities, $activity);
                    }
                }
            }
        }

        $proofs = [];
        foreach ($activities as $activity) {
            foreach ($this->proofs($event, $phoneHash, $activity) as $proof) {
                $proofs[$proof['activity_id'].':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
            }
        }

        return count($proofs) === 1 ? array_values($proofs)[0] : null;
    }

    private function entryPhone(object $event, array $payload): string
    {
        try {
            $stored = json_decode(Crypt::decryptString((string) ($event->payload ?? '')), true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new RuntimeException('Stored message entry is unavailable.');
        }
        $subject = (string) config('edna.subject_id');
        $message = (string) ($event->message_id ?? '');
        if (! $this->positiveId($event->id ?? null) || ! preg_match('/^[0-9]{1,64}$/D', $subject)
            || (string) ($event->subject_id ?? '') !== $subject || ! preg_match('/^[0-9]{1,64}$/D', $message)
            || ! is_array($stored) || (string) ($stored['subjectId'] ?? '') !== $subject
            || (string) ($payload['subjectId'] ?? '') !== $subject
            || (string) ($stored['id'] ?? '') !== $message || (string) ($payload['id'] ?? '') !== $message
            || ! is_array($stored['subscriber'] ?? null) || ! is_array($payload['subscriber'] ?? null)) {
            throw new RuntimeException('Authenticated message entry is inconsistent.');
        }
        $phone = (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
        $storedPhone = (new AttributionJourney)->phoneHash((string) ($stored['subscriber']['identifier'] ?? ''));
        if (! $phone || ! $storedPhone || ! hash_equals($storedPhone, $phone)) {
            throw new RuntimeException('Authenticated message sender is inconsistent.');
        }

        return $phone;
    }

    private function knownChat(object $event, string $phoneHash, int $chatId): ?array
    {
        $dialog = $this->call('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
        $code = is_array($dialog) ? (string) ($dialog['entity_id'] ?? '') : '';
        if (! $this->dialogMatches($dialog, (string) $chatId, $code, $phoneHash)) {
            return null;
        }
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        $sessionId = $parts[5] ?? null;
        if (! $this->positiveId($sessionId)) {
            return null;
        }
        $activities = [];
        foreach ($this->activities(['ASSOCIATED_ENTITY_ID' => (int) $sessionId]) as $activity) {
            if ((string) $activity['ASSOCIATED_ENTITY_ID'] !== (string) $sessionId) {
                throw new RuntimeException('Known chat activity belongs to another session.');
            }
            $this->addActivity($activities, $activity);
        }
        $proofs = [];
        foreach ($activities as $activity) {
            foreach ($this->proofs($event, $phoneHash, $activity, $dialog) as $proof) {
                $proofs[$proof['activity_id'].':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
            }
        }

        return count($proofs) === 1 ? array_values($proofs)[0] : null;
    }

    private function activities(array $filter): array
    {
        $activities = $this->call('crm.activity.list', [
            'filter' => $filter + ['PROVIDER_ID' => 'IMOPENLINES_SESSION'],
            'select' => self::ACTIVITY_FIELDS, 'order' => ['ID' => 'DESC'], 'start' => -1,
        ]);
        // The transport strips pagination metadata. A full page cannot prove completeness.
        if (! is_array($activities) || ! array_is_list($activities) || count($activities) >= 50) {
            throw new RuntimeException('Message activity window is incomplete.');
        }

        return $activities;
    }

    private function addActivity(array &$activities, mixed $activity): void
    {
        if (! is_array($activity) || ! $this->positiveId($activity['ID'] ?? null)
            || ($activity['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
            || ! $this->positiveId($activity['ASSOCIATED_ENTITY_ID'] ?? null)) {
            throw new RuntimeException('Invalid message session activity.');
        }
        $id = (string) $activity['ID'];
        if (isset($activities[$id]) && $activities[$id] !== $activity) {
            throw new RuntimeException('Conflicting message session activities.');
        }
        $activities[$id] = $activity;
        if (count($activities) > 25) {
            throw new RuntimeException('Message activity window requires review.');
        }
    }

    private function proofs(object $event, string $phoneHash, array $activity, ?array $knownDialog = null): array
    {
        $params = $activity['PROVIDER_PARAMS'] ?? null;
        if (is_string($params)) {
            $params = json_decode($params, true);
        }
        $code = is_array($params) ? (string) ($params['USER_CODE'] ?? '') : '';
        if (! $this->codeMatches($code, $phoneHash)) {
            return [];
        }
        $sessionId = (string) $activity['ASSOCIATED_ENTITY_ID'];
        $history = $this->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $sessionId]);
        if (! is_array($history) || (string) ($history['sessionId'] ?? '') !== $sessionId
            || ! $this->positiveId($history['chatId'] ?? null) || ($history['hasNextPage'] ?? null) !== false
            || ! is_array($history['message'] ?? null)) {
            throw new RuntimeException('Message session history is incomplete or inconsistent.');
        }
        $chatId = (string) $history['chatId'];
        $dialog = $knownDialog ?? $this->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $chatId]);
        if (! $this->dialogMatches($dialog, $chatId, $code, $phoneHash)) {
            return [];
        }
        $links = explode('|', (string) ($dialog['entity_data_2'] ?? ''));
        $nativeLeadId = null;
        for ($i = 0; $i + 1 < count($links); $i += 2) {
            if ($links[$i] === 'LEAD' && $this->positiveId($links[$i + 1])) {
                if ($nativeLeadId !== null && $nativeLeadId !== $links[$i + 1]) {
                    throw new RuntimeException('Message chat has conflicting CRM links.');
                }
                $nativeLeadId = $links[$i + 1];
            }
        }
        $parts = explode('|', $code);
        $proofs = [];
        foreach ($history['message'] as $message) {
            if (! is_array($message)) {
                throw new RuntimeException('Invalid native message history.');
            }
            $params = $message['params'] ?? [];
            if (is_string($params)) {
                $params = json_decode($params, true);
            }
            $external = is_array($params) ? ($params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? []) : [];
            $external = is_array($external) ? $external : [$external];
            $external = array_filter($external, fn ($id) => is_string($id) || is_int($id));
            if (! in_array((string) $event->message_id, array_map('strval', $external), true)) {
                continue;
            }
            $sender = (string) ($message['senderid'] ?? '');
            $user = $history['users'][$sender] ?? null;
            if (! $this->positiveId($message['id'] ?? null) || (string) ($message['chatid'] ?? '') !== $chatId
                || $sender !== $parts[3] || ! is_array($user) || ($user['connector'] ?? null) !== true) {
                throw new RuntimeException('Native connector message is inconsistent.');
            }
            $proofs[] = [
                'version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
                'evidence' => 'external_message_id', 'entry_event_id' => (int) $event->id,
                'entry_message_id' => (string) $event->message_id, 'chat_id' => $chatId,
                'session_id' => $sessionId, 'message_id' => (string) $message['id'],
                'activity_id' => (string) $activity['ID'], 'native_lead_id' => $nativeLeadId,
            ];
        }

        return $proofs;
    }

    private function dialogMatches(mixed $dialog, string $chatId, string $code, string $phoneHash): bool
    {
        return is_array($dialog) && (string) ($dialog['id'] ?? '') === $chatId
            && ($dialog['entity_type'] ?? '') === 'LINES'
            && hash_equals($code, (string) ($dialog['entity_id'] ?? '')) && $this->codeMatches($code, $phoneHash);
    }

    private function codeMatches(string $code, string $phoneHash): bool
    {
        $parts = explode('|', $code);
        if (count($parts) !== 4 || $parts[0] !== 'whatsappbyedna' || $parts[1] !== '1' || ! $this->positiveId($parts[3])) {
            return false;
        }
        $recipient = explode('@', $parts[2]);
        $hash = count($recipient) === 2 ? (new AttributionJourney)->phoneHash($recipient[0]) : null;

        return $hash !== null && hash_equals($phoneHash, $hash) && $recipient[1] === (string) config('edna.subject_id');
    }

    private function positiveId(mixed $value): bool
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]{0,18}$/D', (string) $value) === 1
            && filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) !== false;
    }

    private function call(string $method, array $payload): mixed
    {
        if (! in_array($method, ['crm.duplicate.findbycomm', 'crm.lead.list', 'crm.contact.list', 'crm.activity.list',
            'imopenlines.session.history.get', 'imopenlines.dialog.get'], true)) {
            throw new RuntimeException('Unsupported message binding operation.');
        }
        $wait = max(0, $this->lastCall + 0.5 - microtime(true));
        if (++$this->calls > 32 || microtime(true) + $wait + 5 >= $this->deadline) {
            throw new RuntimeException('Message binding read budget exhausted.');
        }
        if ($wait > 0) {
            usleep((int) ceil($wait * 1000000));
        }
        $this->lastCall = microtime(true);
        try {
            return $this->crm->call($method, $payload);
        } catch (Throwable) {
            throw new RuntimeException('Message binding read failed.');
        }
    }
}
