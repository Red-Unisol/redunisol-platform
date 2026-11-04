<?php

namespace App\Services;

use App\Jobs\SendEdnaFlow;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class EdnaFlowResend
{
    private EdnaApi $api;

    private EdnaIntakeBinding $bindings;

    public function __construct(?EdnaApi $api = null, ?EdnaIntakeBinding $bindings = null)
    {
        $this->api = $api ?? app(EdnaApi::class);
        $this->bindings = $bindings ?? app(EdnaIntakeBinding::class);
    }

    public function preview(int $sendId): array
    {
        $send = DB::table('edna_flow_sends')->find($sendId);
        $result = ['send_id' => $sendId, 'case_id' => $send?->request_id,
            'expected_old_mid' => $send?->outgoing_message_id, 'eligible' => false, 'applied' => false];
        try {
            $this->assertEligible($send);
            $this->assertFailedHistory($send, (string) $send->outgoing_message_id);
            $binding = $this->bindings->verified($send);

            return array_replace($result, ['eligible' => true,
                'reason' => 'operator_confirmation_required', 'binding_lead_id' => $binding['lead_id'] ?? null,
                'binding_required_on_apply' => $binding === null, 'active_transport_request_id' => (new EdnaFlowTransport)->id($send)]);
        } catch (Throwable) {
            return $result + ['reason' => 'controlled_resend_not_eligible'];
        }
    }

    public function apply(int $sendId, string $expectedCase, string $expectedLead, string $expectedOldMid, string $operationId, bool $confirmedNoAttention): array
    {
        if (! $confirmedNoAttention || ! Str::isUuid($expectedCase) || ! Str::isUuid($operationId)
            || ! preg_match('/^[1-9][0-9]{0,63}$/D', $expectedLead) || ! preg_match('/^[1-9][0-9]{0,63}$/D', $expectedOldMid)) {
            throw new RuntimeException('Controlled resend requires the case, lead, failed message, operation and operator confirmation.');
        }
        $existing = $this->existingOperation($sendId, $expectedCase, $expectedLead, $expectedOldMid, $operationId);
        if ($existing) {
            return $existing;
        }
        $send = DB::table('edna_flow_sends')->find($sendId);
        $this->assertEligible($send);
        if (! hash_equals($send->request_id, $expectedCase) || $send->outgoing_message_id !== $expectedOldMid) {
            throw new RuntimeException('Controlled resend does not match the recorded case or failed message.');
        }
        // All provider reads precede the first database mutation. FAILED must be
        // final, complete and exact; an uncertain POST can never enter this path.
        $this->assertFailedHistory($send, $expectedOldMid);

        return DB::transaction(function () use ($send, $expectedCase, $expectedLead, $expectedOldMid, $operationId): array {
            $current = DB::table('edna_flow_sends')->where('id', $send->id)->lockForUpdate()->first();
            $existing = $this->existingOperation($send->id, $expectedCase, $expectedLead, $expectedOldMid, $operationId);
            if ($existing) {
                return $existing;
            }
            $this->assertEligible($current);
            foreach (['request_id', 'transport_request_id', 'entry_event_id', 'intake_admission_id', 'outgoing_message_id',
                'state', 'reason', 'send_started_at', 'recipient', 'flow_id', 'subject_id', 'cascade_id'] as $field) {
                if (($current->{$field} ?? null) !== ($send->{$field} ?? null)) {
                    throw new RuntimeException('Controlled resend changed during provider verification.');
                }
            }
            $intake = new EdnaIntake;
            $current = $intake->promoteUnprocessedCurrentFlow($current);
            if (! $intake->isChannelContract($current) || ! $intake->canSend($current)) {
                throw new RuntimeException('Controlled resend requires the original unified intake context.');
            }
            $binding = $this->bindings->resolve($current);
            $entry = $intake->entryContext($current);
            if (! $binding || ! $entry || ($binding['version'] ?? null) !== 1 || ($binding['verified'] ?? null) !== true
                || ($binding['source'] ?? '') !== 'bitrix_openline_session' || ($binding['lead_id'] ?? '') !== $expectedLead
                || ($binding['entry_event_id'] ?? null) !== $entry['event_id'] || ($binding['entry_message_id'] ?? null) !== $entry['message_id']) {
                throw new RuntimeException('Controlled resend does not have the expected original lead binding.');
            }
            $transport = (string) Str::uuid();
            if ($transport === $current->request_id) {
                throw new RuntimeException('Controlled resend requires a new transport identifier.');
            }
            $original = ['flow_send_id' => $current->id, 'attempt_no' => 1,
                'transport_request_id' => (new EdnaFlowTransport)->id($current), 'operation_id' => null, 'expected_lead_id' => null,
                'provider_status' => 'FAILED', 'verified_failed_message_id' => $expectedOldMid,
                'created_at' => $send->created_at, 'updated_at' => $send->updated_at];
            foreach (['state', 'reason', 'send_started_at', 'accepted_at', 'completed_at', 'outgoing_message_id', 'response_event_id'] as $field) {
                $original[$field] = $send->{$field};
            }
            $snapshot = [];
            foreach (['id', 'request_id', 'transport_request_id', 'entry_event_id', 'intake_admission_id', 'journey_id',
                'flow_id', 'subject_id', 'cascade_id', 'intake_contract', 'entry_origin', 'intake_test',
                'state', 'reason', 'send_started_at', 'accepted_at', 'completed_at', 'outgoing_message_id',
                'response_event_id', 'entry_received_at', 'created_at', 'updated_at'] as $field) {
                $snapshot[$field] = $send->{$field} ?? null;
            }
            $original['original_snapshot'] = json_encode($snapshot, JSON_THROW_ON_ERROR);
            DB::table('edna_flow_send_attempts')->insert($original);
            DB::table('edna_flow_send_attempts')->insert(['flow_send_id' => $current->id, 'attempt_no' => 2,
                'transport_request_id' => $transport, 'operation_id' => $operationId, 'expected_lead_id' => $expectedLead,
                'state' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
            $changed = DB::table('edna_flow_sends')->where('id', $current->id)->whereNull('transport_request_id')
                ->whereIn('state', ['rejected', 'failed'])->whereNull('response_event_id')->update([
                    'transport_request_id' => $transport, 'state' => 'pending', 'reason' => null,
                    'send_started_at' => null, 'accepted_at' => null, 'completed_at' => null,
                    'outgoing_message_id' => null, 'response_event_id' => null, 'updated_at' => now(),
                ]);
            if ($changed !== 1) {
                throw new RuntimeException('Controlled resend could not claim the original failed attempt.');
            }
            Queue::connection('edna')->push(new SendEdnaFlow($current->id, $transport), '', 'edna');

            return ['send_id' => (int) $current->id, 'case_id' => $current->request_id, 'transport_request_id' => $transport,
                'attempt_no' => 2, 'operation_id' => $operationId, 'expected_lead_id' => $expectedLead,
                'state' => 'pending', 'applied' => true, 'action' => 'resend_queued'];
        });
    }

    private function existingOperation(int $sendId, string $case, string $lead, string $oldMid, string $operation): ?array
    {
        $attempt = DB::table('edna_flow_send_attempts')->where('operation_id', $operation)->first();
        if (! $attempt) {
            return null;
        }
        $send = DB::table('edna_flow_sends')->find($sendId);
        $original = DB::table('edna_flow_send_attempts')->where('flow_send_id', $sendId)->where('attempt_no', 1)->first();
        if (! $send || (int) $attempt->flow_send_id !== $sendId || $send->request_id !== $case
            || (int) $attempt->attempt_no !== 2 || $attempt->expected_lead_id !== $lead || $original?->outgoing_message_id !== $oldMid
            || $send->transport_request_id !== $attempt->transport_request_id) {
            throw new RuntimeException('Controlled resend operation belongs to different recorded evidence.');
        }

        return ['send_id' => $sendId, 'case_id' => $case, 'transport_request_id' => $attempt->transport_request_id,
            'attempt_no' => 2, 'operation_id' => $operation, 'expected_lead_id' => $lead,
            'state' => $attempt->state, 'applied' => false, 'action' => 'already_scheduled'];
    }

    private function assertEligible(?object $send): void
    {
        $intake = new EdnaIntake;
        if (! $send || ! config('edna.enabled') || ! config('edna.router_enabled') || ! config('edna.intake_enabled')
            || ! config('edna.intake_crm_enabled') || config('edna.intake_entry_scope', 'website') !== 'sales_channel'
            || ! $intake->flowId() || $send->flow_id !== $intake->flowId() || $send->subject_id !== (string) config('edna.subject_id')
            || $send->cascade_id !== (string) config('edna.cascade_id') || ($send->intake_test ?? false)
            || ! in_array($send->state, ['rejected', 'failed'], true) || $send->response_event_id
            || ! preg_match('/^[1-9][0-9]{0,63}$/D', (string) $send->outgoing_message_id)
            || ! $send->send_started_at || ! $send->recipient || ($send->transport_request_id ?? null)
            || DB::table('edna_flow_send_attempts')->where('flow_send_id', $send->id)->exists()
            || DB::table('edna_intake_requests')->where('flow_send_id', $send->id)->exists()
            || ! (new EdnaIntakePilot)->contains($send)) {
            throw new RuntimeException('Recorded Flow is not eligible for one controlled resend.');
        }
        $received = CarbonImmutable::parse($send->entry_received_at);
        if ($received->lte(now()->subHours(23)) || $received->gt(now()->addMinutes(5))) {
            throw new RuntimeException('Controlled resend is outside the customer messaging window.');
        }
        if ($intake->isChannelContract($send) && (! $intake->attribution($send) || ! $intake->entryContext($send))) {
            throw new RuntimeException('Controlled resend original entry is not verifiable.');
        }
        if (! $intake->isChannelContract($send) && ! $send->journey_id) {
            throw new RuntimeException('Controlled resend has no original website context.');
        }
    }

    private function assertFailedHistory(object $send, string $expectedMid): void
    {
        $this->api->assertCascade($send);
        $phone = Crypt::decryptString($send->recipient);
        $response = $this->api->post('messages/history', [
            'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'], 'subjectId' => (int) $send->subject_id,
            'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'],
            'dateFrom' => CarbonImmutable::parse($send->send_started_at)->subMinute()->toIso8601String(),
            'dateTo' => CarbonImmutable::parse($send->send_started_at)->addHours(24)->toIso8601String(),
            'limit' => 1000, 'offset' => 0, 'sort' => [['property' => 'messageId', 'direction' => 'DESC']],
        ]);
        if ($response->status() !== 200 || ! is_array($response->json('content')) || $response->json('hasNext') !== false) {
            throw new RuntimeException('Controlled resend provider history is incomplete.');
        }
        $matches = [];
        foreach ($response->json('content') as $message) {
            if (($message['comment'] ?? null) !== (new EdnaFlowTransport)->id($send)) {
                continue;
            }
            $mid = (string) ($message['messageId'] ?? '');
            if (($message['direction'] ?? '') !== 'OUT' || ($message['channelType'] ?? '') !== 'WHATSAPP'
                || (string) ($message['subjectId'] ?? '') !== $send->subject_id || (string) ($message['cascadeId'] ?? '') !== $send->cascade_id
                || ($message['address'] ?? '') !== $phone || ! preg_match('/^[1-9][0-9]{0,63}$/D', $mid)
                || $mid !== $expectedMid || (isset($matches[$mid]) && $matches[$mid] !== $message)) {
                throw new RuntimeException('Controlled resend provider history does not match the failed attempt.');
            }
            $matches[$mid] = $message;
        }
        if (count($matches) !== 1 || (array_values($matches)[0]['deliveryStatus'] ?? '') !== 'FAILED') {
            throw new RuntimeException('Controlled resend requires one exact terminal FAILED provider message.');
        }
    }
}
