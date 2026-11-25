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

    /** Read snapshots belong to one resolution only, never to an ownership guard. */
    private array $reads = [];

    public function __construct(?EdnaBitrix $crm = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
    }

    /** Greetings and their buttons can act only on each candidate chat's current session. */
    public function resolveCurrent(object $event, array $payload, ?int $knownChatId = null): ?array
    {
        $this->deadline = microtime(true) + 30;
        $this->calls = 0;
        $this->reads = [];
        $phoneHash = $this->entryPhone($event, $payload);
        if ($knownChatId !== null) {
            if ($knownChatId < 1) {
                throw new RuntimeException('Invalid known message chat.');
            }

            return $this->knownChat($event, $phoneHash, $knownChatId);
        }

        $candidates = [];
        $count = 0;
        foreach (['LEAD' => 'lead', 'CONTACT' => 'contact'] as $type => $entity) {
            $result = $this->call('crm.duplicate.findbycomm', [
                'entity_type' => $type, 'type' => 'PHONE', 'values' => [(string) $payload['subscriber']['identifier']],
            ]);
            $ids = is_array($result) ? ($result[$type] ?? []) : null;
            if (! is_array($ids) || ! array_is_list($ids)) {
                throw new RuntimeException('Invalid message candidate identifiers.');
            }
            foreach ($ids as $id) {
                if (! $this->positiveId($id)) {
                    throw new RuntimeException('Invalid message candidate identifier.');
                }
                $candidates[$entity][(string) $id] = (string) $id;
            }
            $count += count($candidates[$entity] ?? []);
            if ($count > 100) {
                throw new RuntimeException('Message candidate window requires review.');
            }
        }

        // Revalidate every candidate before using any CRM-to-chat relation.
        foreach ($candidates as $entity => $ids) {
            foreach (array_chunk(array_values($ids), 50) as $batch) {
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
                    if (! is_array($record['PHONE'] ?? null) || ! collect($record['PHONE'])->contains(fn ($phone) => is_array($phone)
                        && (new AttributionJourney)->phoneHash((string) ($phone['VALUE'] ?? '')) === $phoneHash)) {
                        throw new RuntimeException('Message candidate does not match the sender.');
                    }
                }
            }
        }

        $chats = $this->candidateChats($candidates);

        $proofs = [];
        foreach ($chats as $chatId) {
            // Keep all proofs from each chat: a locally ambiguous chat must not
            // disappear behind another chat that happens to have one match.
            foreach ($this->currentChatProofs($event, $phoneHash, $chatId) as $proof) {
                $proofs[$proof['chat_id'].':'.$proof['activity_id'].':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
            }
        }

        return count($proofs) === 1 ? array_values($proofs)[0] : null;
    }

    /** The caller validates the exact server receipt identity; its lead only narrows discovery. */
    public function resolveReceipt(object $event, array $payload, int $receiptLeadId): ?array
    {
        $this->deadline = microtime(true) + 30;
        $this->calls = 0;
        $this->reads = [];
        $phoneHash = $this->entryPhone($event, $payload);
        if (! $this->positiveId($receiptLeadId)) {
            throw new RuntimeException('Invalid receipt lead hint.');
        }
        $records = $this->call('crm.lead.list', ['filter' => ['@ID' => [(string) $receiptLeadId]],
            'select' => ['ID', 'PHONE', 'CONTACT_ID'], 'start' => -1]);
        if (! is_array($records) || ! array_is_list($records) || count($records) !== 1
            || (string) ($records[0]['ID'] ?? '') !== (string) $receiptLeadId
            || ! is_array($records[0]['PHONE'] ?? null)
            || ! collect($records[0]['PHONE'])->contains(fn ($phone) => is_array($phone)
                && (new AttributionJourney)->phoneHash((string) ($phone['VALUE'] ?? '')) === $phoneHash)) {
            throw new RuntimeException('Receipt lead does not match the authenticated sender.');
        }
        $contact = (string) ($records[0]['CONTACT_ID'] ?? '');
        $candidates = ['lead' => [(string) $receiptLeadId]];
        if ($this->positiveId($contact)) {
            $candidates['contact'] = [$contact];
        } elseif (! in_array($contact, ['', '0'], true)) {
            throw new RuntimeException('Receipt contact hint is invalid.');
        }
        $deals = $this->call('crm.deal.list', ['filter' => ['LEAD_ID' => $receiptLeadId, 'CATEGORY_ID' => 1],
            'select' => ['ID', 'LEAD_ID', 'CONTACT_ID', 'CATEGORY_ID'], 'start' => -1]);
        if (! is_array($deals) || ! array_is_list($deals) || count($deals) >= 50) {
            throw new RuntimeException('Receipt deal discovery is incomplete.');
        }
        foreach ($deals as $deal) {
            if (! is_array($deal) || ! $this->positiveId($deal['ID'] ?? null)
                || (string) ($deal['LEAD_ID'] ?? '') !== (string) $receiptLeadId
                || (string) ($deal['CATEGORY_ID'] ?? '') !== '1'
                || (string) ($deal['CONTACT_ID'] ?? '') !== $contact) {
                throw new RuntimeException('Receipt deal does not match its exact lead and contact.');
            }
            $candidates['deal'][(string) $deal['ID']] = (string) $deal['ID'];
        }
        if (count($candidates['deal'] ?? []) > 25) {
            throw new RuntimeException('Receipt deal window requires review.');
        }
        $proofs = [];
        foreach ($this->candidateChats($candidates) as $chatId) {
            foreach ($this->currentChatProofs($event, $phoneHash, $chatId) as $proof) {
                $proofs[$proof['chat_id'].':'.$proof['activity_id'].':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
            }
        }

        return count($proofs) === 1 ? array_values($proofs)[0] : null;
    }

    private function candidateChats(array $candidates): array
    {
        $chats = [];
        $connectors = [];
        foreach ($candidates as $entity => $ids) {
            foreach ($ids as $id) {
                $rows = $this->call('imopenlines.crm.chat.get', ['CRM_ENTITY_TYPE' => $entity, 'CRM_ENTITY' => (int) $id, 'ACTIVE_ONLY' => 'N']);
                // A full page cannot prove completeness through this transport.
                if (! is_array($rows) || ! array_is_list($rows) || count($rows) >= 50) {
                    throw new RuntimeException('Message chat discovery is incomplete.');
                }
                foreach ($rows as $row) {
                    if (! is_array($row) || ! $this->positiveId($row['CHAT_ID'] ?? null)
                        || ! is_string($row['CONNECTOR_ID'] ?? null) || ! preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $row['CONNECTOR_ID'])) {
                        throw new RuntimeException('Invalid message chat candidate.');
                    }
                    $chat = (string) $row['CHAT_ID'];
                    if (isset($connectors[$chat]) && $connectors[$chat] !== $row['CONNECTOR_ID']) {
                        throw new RuntimeException('Conflicting message chat candidates.');
                    }
                    $connectors[$chat] = $row['CONNECTOR_ID'];
                    if ($row['CONNECTOR_ID'] === 'whatsappbyedna') {
                        $chats[$chat] = (int) $chat;
                    }
                    if (count($chats) > 25) {
                        throw new RuntimeException('Message chat window requires review.');
                    }
                }
            }
        }

        return $chats;
    }

    /** The phone discovers candidates; only the exact native connector message proves a binding. */
    public function resolve(object $event, array $payload, ?int $knownChatId = null): ?array
    {
        $this->deadline = microtime(true) + 30;
        $this->calls = 0;
        $this->reads = [];
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

        // Preserve successful or ambiguous legacy evidence. A large deal history
        // must not exhaust the read budget of a chat already proved by that path.
        if ($proofs || ! app(EdnaDealMessageCutover::class)->applies($event, $payload)) {
            return count($proofs) === 1 ? array_values($proofs)[0] : null;
        }
        $dealActivities = [];
        $this->addDealActivities($dealActivities, $candidates);
        foreach ($dealActivities as $activity) {
            foreach ($this->proofs($event, $phoneHash, $activity) as $proof) {
                $proofs[$proof['activity_id'].':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
            }
        }

        return count($proofs) === 1 ? array_values($proofs)[0] : null;
    }

    /** Related deals discover activity candidates, never select a seller or prove identity. */
    private function addDealActivities(array &$activities, array $candidates): void
    {
        $deals = [];
        foreach ([1 => 'LEAD_ID', 3 => 'CONTACT_ID'] as $type => $field) {
            $ids = array_column(array_filter($candidates, fn ($candidate) => $candidate['type'] === $type), 'id');
            foreach (array_chunk($ids, 50) as $batch) {
                $rows = $this->call('crm.deal.list', [
                    'filter' => ['@'.$field => $batch], 'select' => ['ID', 'LEAD_ID', 'CONTACT_ID'],
                    'order' => ['ID' => 'ASC'], 'start' => -1,
                ]);
                // This transport omits pagination metadata. Never accept a full page.
                if (! is_array($rows) || ! array_is_list($rows) || count($rows) >= 50) {
                    throw new RuntimeException('Related deal discovery is incomplete.');
                }
                foreach ($rows as $row) {
                    if (! is_array($row) || ! $this->positiveId($row['ID'] ?? null)
                        || ! in_array((string) ($row[$field] ?? ''), $batch, true)) {
                        throw new RuntimeException('Related deal response does not match its candidate.');
                    }
                    $id = (string) $row['ID'];
                    $links = ['LEAD_ID' => (string) ($row['LEAD_ID'] ?? ''), 'CONTACT_ID' => (string) ($row['CONTACT_ID'] ?? '')];
                    if (isset($deals[$id]) && $deals[$id] !== $links) {
                        throw new RuntimeException('Related deal bindings changed during discovery.');
                    }
                    $deals[$id] = $links;
                    if (count($deals) > 25) {
                        throw new RuntimeException('Related deal window requires review.');
                    }
                }
            }
        }
        if (! $deals) {
            return;
        }
        foreach ($this->activities(['OWNER_TYPE_ID' => 2, '@OWNER_ID' => array_map('strval', array_keys($deals))]) as $activity) {
            if ((string) ($activity['OWNER_TYPE_ID'] ?? '') !== '2'
                || ! isset($deals[(string) ($activity['OWNER_ID'] ?? '')])) {
                throw new RuntimeException('Deal activity is outside the proven candidate set.');
            }
            $this->addActivity($activities, $activity);
        }
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

    /** A previous association is a lookup hint. Only this event's live native evidence can authorize work. */
    public function resolveMenuHint(object $event, array $payload, int $chatId): ?array
    {
        $this->deadline = microtime(true) + 30;
        $this->calls = 0;
        $this->reads = [];
        $phoneHash = $this->entryPhone($event, $payload);
        try {
            $history = $this->call('imopenlines.session.history.get', ['CHAT_ID' => $chatId]);
        } catch (RuntimeException) {
            // A removed or inaccessible chat is only a hint. Normal discovery can still succeed.
            return null;
        }
        $chat = $history['chat'][$chatId] ?? null;
        if (! is_array($chat) || (string) ($history['chatId'] ?? '') !== (string) $chatId
            || ! $this->positiveId($history['sessionId'] ?? null)) {
            return null;
        }
        $dialog = ['id' => $chat['id'] ?? null, 'entity_type' => $chat['entityType'] ?? null,
            'entity_id' => $chat['entityId'] ?? null, 'entity_data_1' => $chat['entityData1'] ?? '',
            'entity_data_2' => $chat['entityData2'] ?? null];
        $code = (string) $dialog['entity_id'];
        $session = (string) $history['sessionId'];
        if (! $this->dialogMatches($dialog, (string) $chatId, $code, $phoneHash)
            || (explode('|', $dialog['entity_data_1'])[5] ?? '') !== $session
            || ! is_string($dialog['entity_data_2'])) {
            return null;
        }
        $proofs = $this->sessionActivityProofs($event, $phoneHash, $session, $dialog, $history);

        if (count($proofs) > 1) {
            throw new RuntimeException('Ambiguous native message in the verified chat.');
        }

        return $proofs[0] ?? null;
    }

    private function knownChat(object $event, string $phoneHash, int $chatId): ?array
    {
        $proofs = $this->currentChatProofs($event, $phoneHash, $chatId);

        return count($proofs) === 1 ? array_values($proofs)[0] : null;
    }

    private function currentChatProofs(object $event, string $phoneHash, int $chatId): array
    {
        $dialog = $this->call('imopenlines.dialog.get', ['CHAT_ID' => $chatId]);
        $code = is_array($dialog) ? (string) ($dialog['entity_id'] ?? '') : '';
        if (! $this->dialogMatches($dialog, (string) $chatId, $code, $phoneHash)) {
            return [];
        }
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        $sessionId = $parts[5] ?? null;
        if (! $this->positiveId($sessionId)) {
            return [];
        }
        return $this->sessionActivityProofs($event, $phoneHash, (string) $sessionId, $dialog);
    }

    private function sessionActivityProofs(object $event, string $phoneHash, string $sessionId, array $dialog, ?array $history = null): array
    {
        $activities = [];
        foreach ($this->activities(['ASSOCIATED_ENTITY_ID' => (int) $sessionId]) as $activity) {
            if ((string) $activity['ASSOCIATED_ENTITY_ID'] !== (string) $sessionId) {
                throw new RuntimeException('Known chat activity belongs to another session.');
            }
            $this->addActivity($activities, $activity);
        }
        $proofs = [];
        foreach ($activities as $activity) {
            foreach ($this->proofs($event, $phoneHash, $activity, $dialog, $history) as $proof) {
                $proofs[$proof['activity_id'].':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
            }
        }

        return array_values($proofs);
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

    private function proofs(object $event, string $phoneHash, array $activity, ?array $knownDialog = null, ?array $firstPage = null): array
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
        $history = $firstPage ?? $this->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $sessionId]);
        $chatId = (string) ($history['chatId'] ?? '');
        $this->validateHistoryPage($history, $sessionId, $chatId);
        if ($knownDialog === null && $history['hasNextPage']) {
            throw new RuntimeException('Message session history is incomplete or inconsistent.');
        }
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
        $cursor = null;
        while (true) {
            $proofs = $this->pageProofs($history, $event, $chatId, $sessionId, (string) $activity['ID'], $parts[3], $nativeLeadId);
            // A historical chat is only a shortcut. On a miss, let live CRM discovery
            // consider other chats before paging through a possibly obsolete one.
            if ($proofs || ! $history['hasNextPage'] || $firstPage !== null) {
                return $proofs;
            }
            $next = $history['nextId'] ?? null;
            $date = $history['nextDate'] ?? null;
            if (! $this->positiveId($next) || ! $this->positiveId($date) || ($cursor !== null && (int) $next >= $cursor)) {
                throw new RuntimeException('Message session history cursor is incomplete or inconsistent.');
            }
            $cursor = (int) $next;
            $history = $this->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $sessionId,
                'LAST_ID' => $cursor, 'LAST_DATE' => (int) $date]);
            $this->validateHistoryPage($history, $sessionId, $chatId);
        }
    }

    private function validateHistoryPage(mixed $history, string $sessionId, string $chatId): void
    {
        if (! is_array($history) || (string) ($history['sessionId'] ?? '') !== $sessionId || ! $this->positiveId($chatId)
            || (string) ($history['chatId'] ?? '') !== $chatId || ! is_bool($history['hasNextPage'] ?? null)
            || ! is_array($history['message'] ?? null)) {
            throw new RuntimeException('Message session history is incomplete or inconsistent.');
        }
    }

    private function pageProofs(array $history, object $event, string $chatId, string $sessionId, string $activityId,
        string $connectorUser, ?string $nativeLeadId): array
    {
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
                || $sender !== $connectorUser || ! is_array($user) || ($user['connector'] ?? null) !== true) {
                throw new RuntimeException('Native connector message is inconsistent.');
            }
            $proofs[] = [
                'version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
                'evidence' => 'external_message_id', 'entry_event_id' => (int) $event->id,
                'entry_message_id' => (string) $event->message_id, 'chat_id' => $chatId,
                'session_id' => $sessionId, 'message_id' => (string) $message['id'],
                'activity_id' => $activityId, 'native_lead_id' => $nativeLeadId,
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
        if (! in_array($method, ['crm.duplicate.findbycomm', 'crm.lead.list', 'crm.contact.list', 'crm.deal.list', 'crm.activity.list',
            'imopenlines.session.history.get', 'imopenlines.dialog.get', 'imopenlines.crm.chat.get'], true)) {
            throw new RuntimeException('Unsupported message binding operation.');
        }
        // Multiple CRM activities can point at the same native session. Reuse
        // their read snapshot without dropping any candidate proof or ambiguity.
        // resolve()/resolveCurrent() clear it before each new message/attempt;
        // the caller's live ownership checks use EdnaBitrix directly.
        if (microtime(true) >= $this->deadline) {
            throw new RuntimeException('Message binding read budget exhausted.');
        }
        $key = hash('sha256', $method."\0".serialize($payload));
        if (array_key_exists($key, $this->reads)) {
            return $this->reads[$key];
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
            return $this->reads[$key] = $this->crm->call($method, $payload);
        } catch (Throwable) {
            throw new RuntimeException('Message binding read failed.');
        }
    }
}
