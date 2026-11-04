<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** Resolves one original channel lead from the exact Edna message in its Bitrix session. */
class EdnaIntakeBinding
{
    private EdnaBitrix $crm;

    private float $deadline;

    private float $lastCall = 0;

    public function __construct(?EdnaBitrix $crm = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
    }

    /** A local read only: callers must not spend the CRM processing timeout resolving a link. */
    public function verified(object $send): ?array
    {
        if ((string) $send->subject_id !== (string) config('edna.subject_id')) {
            throw new RuntimeException('Intake binding belongs to another channel.');
        }
        $row = DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->first();
        if (! $row) {
            return null;
        }
        if ($row->case_id !== $send->request_id || (int) $row->entry_event_id !== (int) $send->entry_event_id) {
            throw new RuntimeException('Stored intake binding requires reconciliation.');
        }
        if ($row->state !== 'verified') {
            return null;
        }
        $proof = json_decode($row->proof, true, 16, JSON_THROW_ON_ERROR);
        if (! is_array($proof) || ($proof['version'] ?? null) !== 1 || ($proof['verified'] ?? null) !== true
            || ($proof['source'] ?? '') !== 'bitrix_openline_session' || ($proof['evidence'] ?? '') !== 'external_message_id'
            || ($proof['entry_event_id'] ?? null) !== (int) $send->entry_event_id
            || (string) ($proof['lead_id'] ?? '') !== (string) $row->lead_id) {
            throw new RuntimeException('Invalid stored intake proof.');
        }

        return $proof;
    }

    public function resolve(object $send): ?array
    {
        $this->deadline = microtime(true) + 40;
        if ((string) $send->subject_id !== (string) config('edna.subject_id')) {
            throw new RuntimeException('Intake binding belongs to another channel.');
        }
        $existing = DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->first();
        if ($existing && ($existing->case_id !== $send->request_id || (int) $existing->entry_event_id !== (int) $send->entry_event_id)) {
            throw new RuntimeException('Stored intake binding requires reconciliation.');
        }
        if ($existing?->state === 'verified') {
            return $this->verified($send);
        }
        if ($existing?->state === 'review') {
            return null;
        }
        $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
        $payload = $entry?->payload ? json_decode(Crypt::decryptString($entry->payload), true, 16, JSON_THROW_ON_ERROR) : null;
        $phone = $send->recipient ? Crypt::decryptString($send->recipient) : '';
        if (! $entry || ! is_array($payload) || (string) $send->subject_id !== (string) config('edna.subject_id')
            || (string) $entry->subject_id !== (string) $send->subject_id
            || (string) $entry->message_id !== (string) ($payload['id'] ?? '')
            || (string) ($payload['subjectId'] ?? '') !== (string) $send->subject_id
            || ! hash_equals($phone, (string) ($payload['subscriber']['identifier'] ?? ''))) {
            throw new RuntimeException('Stored intake entry does not match the send.');
        }
        $phoneHash = (new AttributionJourney)->phoneHash($phone);
        if (! $phoneHash) {
            throw new RuntimeException('Unsupported intake channel identity.');
        }
        DB::table('edna_intake_bindings')->insertOrIgnore([
            'flow_send_id' => $send->id, 'case_id' => $send->request_id, 'entry_event_id' => $entry->id,
            'state' => 'pending', 'reason' => 'crm_binding_pending', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $duplicates = $this->call('crm.duplicate.findbycomm', ['entity_type' => 'LEAD', 'type' => 'PHONE', 'values' => [$phone]]);
        $ids = array_values(array_unique(array_map('strval', is_array($duplicates) ? ($duplicates['LEAD'] ?? []) : [])));
        if (count($ids) > 100 || collect($ids)->contains(fn ($id) => ! ctype_digit($id))) {
            return $this->pending($send, 'crm_binding_ambiguous');
        }
        $matches = [];
        foreach (array_chunk($ids, 50) as $batch) {
            $leads = $this->call('crm.lead.list', ['filter' => ['@ID' => $batch], 'select' => ['ID', 'PHONE'], 'start' => -1]);
            if (! is_array($leads) || ! array_is_list($leads)) {
                throw new RuntimeException('Invalid original lead candidates.');
            }
            $returned = array_map(fn ($lead) => (string) ($lead['ID'] ?? ''), $leads);
            $expected = $batch;
            sort($returned);
            sort($expected);
            if ($returned !== $expected) {
                throw new RuntimeException('Original lead candidate response is incomplete.');
            }
            foreach ($leads as $lead) {
                $leadId = (string) ($lead['ID'] ?? '');
                if (! in_array($leadId, $batch, true) || ! collect($lead['PHONE'] ?? [])
                    ->contains(fn ($p) => (new AttributionJourney)->phoneHash((string) ($p['VALUE'] ?? '')) === $phoneHash)) {
                    throw new RuntimeException('Original lead candidate does not match the channel.');
                }
                foreach ($this->proofs($send, $entry, $leadId) as $proof) {
                    $matches[$leadId.':'.$proof['session_id'].':'.$proof['message_id']] = $proof;
                }
            }
        }
        if (count($matches) !== 1) {
            return $this->pending($send, $matches ? 'crm_binding_ambiguous' : 'crm_binding_pending');
        }
        $proof = array_values($matches)[0];

        return DB::transaction(function () use ($send, $proof): ?array {
            $row = DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->lockForUpdate()->first();
            if ($row->state === 'verified') {
                $stored = json_decode($row->proof, true, 16, JSON_THROW_ON_ERROR);
                if ($stored !== $proof) {
                    throw new RuntimeException('Concurrent intake bindings disagree.');
                }

                return $stored;
            }
            // A channel lead cannot silently become the original lead of two independent cases.
            $other = DB::table('edna_intake_bindings')->where('lead_id', $proof['lead_id'])
                ->where('flow_send_id', '<>', $send->id)->first();
            if ($other) {
                DB::table('edna_intake_bindings')->where('id', $row->id)->update([
                    'state' => 'review', 'reason' => 'crm_lead_already_bound', 'updated_at' => now(),
                ]);

                return null;
            }
            DB::table('edna_intake_bindings')->where('id', $row->id)->update([
                'state' => 'verified', 'reason' => null, 'lead_id' => $proof['lead_id'],
                'proof' => json_encode($proof, JSON_THROW_ON_ERROR), 'verified_at' => now(), 'updated_at' => now(),
            ]);

            return $proof;
        });
    }

    private function proofs(object $send, object $entry, string $leadId): array
    {
        $activities = $this->call('crm.activity.list', [
            'filter' => ['OWNER_TYPE_ID' => 1, 'OWNER_ID' => $leadId, 'PROVIDER_ID' => 'IMOPENLINES_SESSION'],
            'select' => ['ID', 'OWNER_ID', 'OWNER_TYPE_ID', 'PROVIDER_ID', 'ASSOCIATED_ENTITY_ID', 'PROVIDER_PARAMS'],
            'order' => ['ID' => 'DESC'], 'start' => -1,
        ]);
        if (! is_array($activities) || count($activities) >= 50) {
            throw new RuntimeException('Original lead sessions require review.');
        }
        $proofs = [];
        foreach ($activities as $activity) {
            if ((string) ($activity['OWNER_ID'] ?? '') !== $leadId || (int) ($activity['OWNER_TYPE_ID'] ?? 0) !== 1
                || ($activity['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION') {
                throw new RuntimeException('Session activity does not belong to the original lead.');
            }
            $sessionId = (string) ($activity['ASSOCIATED_ENTITY_ID'] ?? '');
            $userCode = (string) ($activity['PROVIDER_PARAMS']['USER_CODE'] ?? '');
            $parts = explode('|', $userCode);
            if (! ctype_digit($sessionId) || (int) $sessionId < 1 || count($parts) < 4
                || $parts[0] !== 'whatsappbyedna' || $parts[1] !== '1') {
                continue;
            }
            $history = $this->call('imopenlines.session.history.get', ['SESSION_ID' => (int) $sessionId]);
            if (! is_array($history) || (string) ($history['sessionId'] ?? '') !== $sessionId
                || ! ctype_digit((string) ($history['chatId'] ?? '')) || (int) $history['chatId'] < 1) {
                throw new RuntimeException('Bitrix returned another session.');
            }
            // A truncated history is not proof that this case has a unique source.
            if (($history['hasNextPage'] ?? null) !== false) {
                throw new RuntimeException('Original session history is incomplete.');
            }
            $chatId = (string) $history['chatId'];
            $dialog = $this->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $chatId]);
            $links = explode('|', (string) ($dialog['entity_data_2'] ?? ''));
            $crmLead = null;
            for ($i = 0; $i + 1 < count($links); $i += 2) {
                if ($links[$i] === 'LEAD') {
                    $crmLead = $links[$i + 1];
                }
            }
            if ((string) ($dialog['id'] ?? '') !== $chatId || ($dialog['entity_type'] ?? '') !== 'LINES'
                || ! hash_equals($userCode, (string) ($dialog['entity_id'] ?? '')) || $crmLead !== $leadId) {
                continue;
            }
            $messages = $history['message'] ?? [];
            if (! is_array($messages)) {
                throw new RuntimeException('Invalid session messages.');
            }
            foreach ($messages as $message) {
                $params = $message['params'] ?? [];
                $params = is_string($params) ? json_decode($params, true) : $params;
                $external = is_array($params) ? ($params['connectorMid'] ?? $params['CONNECTOR_MID'] ?? []) : [];
                $external = is_array($external) ? $external : [$external];
                if (! in_array((string) $entry->message_id, array_map('strval', $external), true)) {
                    continue;
                }
                $messageId = (string) ($message['id'] ?? '');
                if (! ctype_digit($messageId) || (int) $messageId < 1
                    || (string) ($message['chatid'] ?? $chatId) !== $chatId
                    || ! isset($message['date'])
                    || abs(CarbonImmutable::parse($message['date'])->diffInSeconds(CarbonImmutable::parse($send->entry_received_at), false)) > 300) {
                    throw new RuntimeException('Native message does not match the intake entry.');
                }
                $proofs[] = [
                    'version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
                    'lead_id' => $leadId, 'chat_id' => $chatId, 'session_id' => $sessionId, 'message_id' => $messageId,
                    'entry_event_id' => (int) $entry->id, 'entry_message_id' => (string) $entry->message_id,
                    'evidence' => 'external_message_id',
                ];
            }
        }

        return $proofs;
    }

    private function pending(object $send, string $reason): ?array
    {
        DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->where('state', '<>', 'verified')
            ->update(['reason' => $reason, 'updated_at' => now()]);

        return null;
    }

    private function call(string $method, array $payload): mixed
    {
        if (! in_array($method, ['crm.duplicate.findbycomm', 'crm.lead.list', 'crm.activity.list',
            'imopenlines.session.history.get', 'imopenlines.dialog.get'], true)) {
            throw new RuntimeException('Unsupported intake binding operation.');
        }
        $wait = max(0, $this->lastCall + 1.0 - microtime(true));
        if (microtime(true) + $wait >= $this->deadline) {
            throw new RuntimeException('Intake binding read window exhausted.');
        }
        if ($wait > 0) {
            usleep((int) ceil($wait * 1000000));
        }
        $this->lastCall = microtime(true);

        return $this->crm->call($method, $payload);
    }
}
