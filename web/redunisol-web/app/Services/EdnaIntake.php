<?php

namespace App\Services;

use App\Jobs\ProcessEdnaIntake;
use App\Jobs\ResolveEdnaIntakeBinding;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;

class EdnaIntake
{
    public const CONTRACT = 'website-intake-v1';

    public const CHANNEL_CONTRACT = 'whatsapp-intake-v2';

    public const TEST_REFERENCE = 'PRUEBAFORM';

    public const TEST_CONTRACT = 'website-intake-e2e-v1';

    public function isTestEntry(string $text): bool
    {
        preg_match_all('/\(ref:\s*([^)]*)\)/i', $text, $matches);

        return count($matches[1]) === 1 && strtoupper(trim($matches[1][0])) === self::TEST_REFERENCE;
    }

    public function testJourney(string $phone, string $subject): ?string
    {
        if (! config('attribution.enabled')) {
            return null;
        }
        $journeys = new AttributionJourney;
        $touch = ['utm_source' => 'test', 'utm_medium' => 'whatsapp', 'utm_campaign' => 'whatsapp_intake_e2e'];
        $journey = $journeys->create(['version' => 1, 'first' => $touch, 'last' => $touch,
            'test_reference' => self::TEST_REFERENCE]);

        return $journeys->bind('(ref: '.$journey->id.')', $phone, $subject);
    }

    public function flowId(): ?string
    {
        $id = (string) config('edna.intake_flow_id');

        return preg_match('/^[0-9]{1,18}$/D', $id) && ! in_array($id, [EdnaFlowRouter::FLOW_ID, EdnaAssistance::FLOW_ID], true) ? $id : null;
    }

    public function allowed(string $phone): bool
    {
        $recipients = config('edna.intake_recipients', []);

        return config('edna.enabled') && config('edna.intake_enabled')
            && ($recipients === [] || in_array($phone, $recipients, true));
    }

    public function salesChannelEntry(object $event, array $payload): bool
    {
        if (config('edna.intake_entry_scope', 'website') !== 'sales_channel'
            || $event->subject_id !== (string) config('edna.subject_id')
            || ! in_array($payload['messageContent']['type'] ?? '', ['TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO', 'LIST_PICKER'], true)
            || $this->isTestEntry((string) ($payload['messageContent']['text'] ?? ''))) {
            return false;
        }
        $start = config('edna.intake_sales_channel_start_at');
        $received = $payload['receivedAt'] ?? '';
        if (! is_string($start) || ! is_string($received)
            || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $start)
            || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $received)) {
            return false;
        }
        try {
            return CarbonImmutable::parse($received)->gte(CarbonImmutable::parse($start));
        } catch (\Throwable) {
            return false;
        }
    }

    // The authenticated inbox worker owns the surrounding event transaction.
    public function receiveEntry(object $event, array $payload): bool
    {
        if (! $this->salesChannelEntry($event, $payload)) {
            return false;
        }
        (new EdnaFlowRouter)->start($event, $payload);

        return true;
    }

    public function admit(string $subject, string $phone, ?string $journeyId, CarbonImmutable $received, bool $channelEntry = false): ?object
    {
        $flowId = $this->flowId();
        if (! config('edna.enabled') || ! config('edna.intake_enabled') || ! $flowId || (! $journeyId && ! $channelEntry)) {
            return null;
        }
        $start = config($channelEntry ? 'edna.intake_sales_channel_start_at' : 'edna.intake_start_at');
        $acceptNew = $this->allowed($phone) && $start
            && $received->gte(CarbonImmutable::parse($start));

        return (new EdnaIntakePilot)->reserve($subject, $phone, $flowId, (bool) $acceptNew);
    }

    public function attribution(object $send): ?array
    {
        if ($this->isChannelContract($send)) {
            try {
                $snapshot = json_decode(Crypt::decryptString($send->attribution_snapshot ?? ''), true, 32, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                return null;
            }
            $origin = $send->entry_origin ?? '';
            if (! is_array($snapshot) || ($snapshot['version'] ?? null) !== 1
                || ! in_array($origin, ['website', 'whatsapp_directo', 'unknown'], true)
                || ! is_array($snapshot['first'] ?? null) || ! is_array($snapshot['last'] ?? null)
                || ($snapshot['wa']['WA_FLOW_ID'] ?? null) !== $send->flow_id
                || ($snapshot['wa']['WA_ENTRY'] ?? null) !== ($origin === 'website' ? 'website' : 'whatsapp_directo')
                || ($origin === 'website'
                    ? ($snapshot['status'] ?? '') !== 'resolved' || empty($snapshot['journey_id'])
                    : ($snapshot['status'] ?? '') !== 'unknown' || ! empty($snapshot['journey_id'])
                        || $snapshot['first'] !== [] || $snapshot['last'] !== [])) {
                return null;
            }

            return $snapshot;
        }
        $journeys = new AttributionJourney;
        $journey = config('attribution.enabled') ? $journeys->find($send->journey_id) : null;
        $hash = $send->recipient ? $journeys->phoneHash(Crypt::decryptString($send->recipient)) : null;
        if (! $journey || ! $hash || ! $journey->recipient_hash
            || ! hash_equals($journey->recipient_hash, $hash) || $journey->subject_id !== $send->subject_id) {
            return null;
        }

        return $journeys->snapshot($journey) + ['status' => 'resolved', 'journey_id' => $journey->id,
            'wa_assisted' => true, 'wa' => ['WA_ENTRY' => 'website', 'WA_FLOW' => 'web_whatsapp_intake', 'WA_FLOW_ID' => $send->flow_id]];
    }

    public function freezeEntryAttribution(object $event, array $payload, ?string $journeyId, string $flowId): array
    {
        $journeys = new AttributionJourney;
        $phone = (string) ($payload['subscriber']['identifier'] ?? '');
        $journey = $journeyId && config('attribution.enabled') ? $journeys->find($journeyId) : null;
        $hash = $journeys->phoneHash($phone);
        if ($journey && $hash && $journey->recipient_hash
            && hash_equals($journey->recipient_hash, $hash) && $journey->subject_id === $event->subject_id) {
            $snapshot = array_replace($journeys->snapshot($journey), ['status' => 'resolved', 'journey_id' => $journey->id,
                'wa_assisted' => true, 'wa' => ['WA_ENTRY' => 'website', 'WA_FLOW' => 'web_whatsapp_intake', 'WA_FLOW_ID' => $flowId]]);

            return ['origin' => 'website', 'journey_id' => $journey->id, 'snapshot' => $snapshot];
        }
        $origin = preg_match('/\(ref\s*:/i', (string) ($payload['messageContent']['text'] ?? ''))
            || ! empty($payload['messageContent']['referral']) ? 'unknown' : 'whatsapp_directo';
        $snapshot = ['version' => 1, 'status' => 'unknown', 'first' => [], 'last' => [], 'journey_id' => null,
            'wa_assisted' => true, 'wa' => ['WA_ENTRY' => 'whatsapp_directo', 'WA_FLOW' => 'web_whatsapp_intake', 'WA_FLOW_ID' => $flowId]];
        if (! empty($payload['messageContent']['referral'])) {
            $snapshot['referral'] = $payload['messageContent']['referral'];
        }

        return ['origin' => $origin, 'journey_id' => null, 'snapshot' => $snapshot];
    }

    public function isChannelContract(object $send): bool
    {
        return ! ($send->intake_test ?? false) && ($send->intake_contract ?? null) === self::CHANNEL_CONTRACT;
    }

    public function contractFor(object $send): string
    {
        return ($send->intake_test ?? false) ? self::TEST_CONTRACT
            : ($this->isChannelContract($send) ? self::CHANNEL_CONTRACT : self::CONTRACT);
    }

    public function requiresChannelContract(object $send): bool
    {
        return config('edna.intake_entry_scope', 'website') === 'sales_channel'
            && $this->flowId() && $send->flow_id === $this->flowId() && ! ($send->intake_test ?? false);
    }

    // Upgrade only the current, unprocessed website Flow. Keep every transport
    // identifier and admission; uncertain or previously written CRM cases stay put.
    public function promoteUnprocessedCurrentFlow(object $send): object
    {
        if (! $this->requiresChannelContract($send)) {
            return $send;
        }

        return DB::transaction(function () use ($send): object {
            $current = DB::table('edna_flow_sends')->where('id', $send->id)->lockForUpdate()->first();
            if (! $current || ($current->intake_contract ?? null) !== null || ! $current->journey_id
                || ! $this->canSend($current)) {
                return $current ?? $send;
            }
            $request = DB::table('edna_intake_requests')->where('flow_send_id', $current->id)->lockForUpdate()->first();
            if ($request && ($request->state !== 'pending' || $request->lead_id || $request->contact_id)) {
                return $current;
            }
            $entry = DB::table('edna_incoming_events')->find($current->entry_event_id);
            try {
                $payload = $entry ? json_decode(Crypt::decryptString($entry->payload), true, 32, JSON_THROW_ON_ERROR) : null;
                if (! is_array($payload)) {
                    return $current;
                }
                $frozen = $this->freezeEntryAttribution($entry, $payload, $current->journey_id, $current->flow_id);
                $candidate = clone $current;
                $candidate->intake_contract = self::CHANNEL_CONTRACT;
                $candidate->entry_origin = $frozen['origin'];
                $candidate->attribution_snapshot = Crypt::encryptString(json_encode($frozen['snapshot'], JSON_THROW_ON_ERROR));
                if (! $this->canSend($candidate)) {
                    return $current;
                }
            } catch (\Throwable) {
                return $current;
            }
            DB::table('edna_flow_sends')->where('id', $current->id)->whereNull('intake_contract')->update([
                'intake_contract' => $candidate->intake_contract, 'entry_origin' => $candidate->entry_origin,
                'attribution_snapshot' => $candidate->attribution_snapshot, 'updated_at' => now(),
            ]);

            return $candidate;
        });
    }

    public function entryContext(object $send): ?array
    {
        if (! $this->isChannelContract($send)) {
            return null;
        }
        $event = DB::table('edna_incoming_events')->find($send->entry_event_id);
        try {
            $payload = $event ? json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR) : null;
            if (! $event || ! is_array($payload) || $event->subject_id !== $send->subject_id
                || $send->subject_id !== (string) config('edna.subject_id')
                || ($payload['id'] ?? null) !== $event->message_id
                || ($payload['subjectId'] ?? null) !== $send->subject_id
                || ! hash_equals(Crypt::decryptString($send->recipient), (string) ($payload['subscriber']['identifier'] ?? ''))
                || ! preg_match('/^[0-9]{1,64}$/D', $event->message_id)
                || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', (string) ($payload['receivedAt'] ?? ''))) {
                return null;
            }
            $received = CarbonImmutable::parse($payload['receivedAt']);
        } catch (\Throwable) {
            return null;
        }

        return ['version' => 1, 'source' => 'edna_authenticated', 'event_id' => (int) $event->id,
            'message_id' => $event->message_id, 'subject_id' => $send->subject_id,
            'received_at' => $received->toIso8601String(), 'origin' => $send->entry_origin];
    }

    public function canSend(object $send): bool
    {
        if (! config('edna.enabled') || ! config('edna.intake_enabled')) {
            return false;
        }
        $attribution = $this->attribution($send);
        $test = (bool) ($send->intake_test ?? false);
        $context = $test
            ? ! $send->intake_admission_id && $send->flow_id === $this->flowId()
                && ($attribution['test_reference'] ?? null) === self::TEST_REFERENCE
            : (new EdnaIntakePilot)->contains($send) && ! isset($attribution['test_reference']);

        return $context && $attribution !== null && (! $this->isChannelContract($send) || $this->entryContext($send) !== null);
    }

    // Runs under the authenticated inbox transaction. The send ledger proves Flow identity.
    public function receive(object $event, array $payload): bool
    {
        if (($payload['messageContent']['type'] ?? '') !== 'FLOW') {
            return false;
        }
        $send = DB::table('edna_flow_sends')->where('request_id', $payload['replyOutMessageExternalRequestId'] ?? '')->first();
        if (! $send || $send->flow_id === EdnaFlowRouter::FLOW_ID) {
            return false;
        }
        $router = new EdnaFlowRouter;
        $context = $router->correlate($event, $payload, true);
        if (! $context || ! $this->canSend($send)) {
            throw new RuntimeException('Intake context requires review.');
        }
        $existing = DB::table('edna_intake_requests')->where('flow_send_id', $send->id)->first();
        if ($existing) {
            $router->record($event->id, 'intake_duplicate_response', $send->id);

            return true;
        }
        $send = $this->promoteUnprocessedCurrentFlow($send);
        if ($this->requiresChannelContract($send) && ! $this->isChannelContract($send)) {
            throw new RuntimeException('Current intake requires its original channel binding.');
        }
        $answer = json_decode($payload['messageContent']['text'], true, 16, JSON_THROW_ON_ERROR);
        if (! is_array($answer) || array_is_list($answer)) {
            throw new RuntimeException('Invalid intake answer.');
        }
        $channel = $this->isChannelContract($send);
        $id = DB::table('edna_intake_requests')->insertGetId([
            'flow_send_id' => $send->id, 'response_event_id' => $event->id,
            'answer' => Crypt::encryptString(json_encode($answer, JSON_THROW_ON_ERROR)),
            'received_at' => CarbonImmutable::parse($payload['receivedAt']),
            'state' => $channel ? 'awaiting_binding' : 'pending',
            'reason' => $channel ? 'crm_binding_pending' : null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $router->complete($event, $context);
        Queue::connection('edna')->push($channel ? new ResolveEdnaIntakeBinding($id) : new ProcessEdnaIntake($id), '', 'edna');

        return true;
    }
}
