<?php

namespace App\Services;

use App\Jobs\ResolveEdnaIntakeBinding;
use App\Jobs\SendEdnaFlow;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;

class EdnaFlowRouter
{
    public const FLOW_ID = '1850162769693486';

    public function scope(string $subject, string $recipient, ?string $flowId = null): string
    {
        return hash_hmac('sha256', $subject.':'.($flowId ?? self::FLOW_ID).':'.$recipient, (string) config('app.key'));
    }

    // Caller holds the inbox row lock and commits the ledger + queued job together.
    public function start(object $event, array $payload): void
    {
        if (! config('edna.router_enabled')) {
            $this->record($event->id, 'disabled');

            return;
        }
        $intake = new EdnaIntake;
        $text = (string) ($payload['messageContent']['text'] ?? '');
        $test = $intake->isTestEntry($text);
        $channelEntry = $intake->salesChannelEntry($event, $payload);
        $journeyId = $test ? null : (new AttributionJourney)->bind($text,
            (string) $payload['subscriber']['identifier'], (string) $event->subject_id);
        $received = CarbonImmutable::parse($payload['receivedAt']);
        $start = config('edna.router_start_at');
        if (! $start || ! config('edna.api_key') || ! preg_match('/^[0-9]+$/D', (string) config('edna.cascade_id'))) {
            throw new RuntimeException('Edna router configuration is incomplete.');
        }
        if ($received->lt(CarbonImmutable::parse($start))) {
            $this->record($event->id, 'before_activation');

            return;
        }
        if ($received->lt(now()->subHours(23)) || $received->gt(now()->addMinutes(5))) {
            $this->record($event->id, 'outside_send_window');

            return;
        }
        $phone = $payload['subscriber']['identifier'];
        if (! preg_match('/^[0-9]{10,15}$/D', $phone)) {
            $this->record($event->id, 'unsupported_recipient');

            return;
        }
        $allowed = config('edna.router_recipients', []);
        if (! $test && $allowed && ! in_array($phone, $allowed, true)) {
            $this->record($event->id, 'outside_pilot');

            return;
        }
        if ($test && (! config('edna.intake_enabled') || ! $intake->flowId())) {
            $this->record($event->id, 'test_intake_unconfigured');

            return;
        }
        $admission = $test ? null : $intake->admit($event->subject_id, $phone, $journeyId, $received, $channelEntry);
        if ($channelEntry && ! $admission) {
            $this->record($event->id, 'intake_admission_unavailable');

            return;
        }
        $flowId = $test ? $intake->flowId() : ($admission?->flow_id ?? self::FLOW_ID);
        $scope = $test
            ? hash_hmac('sha256', 'intake-test-entry:'.$event->id, (string) config('app.key'))
            : ($admission
            ? hash_hmac('sha256', 'intake-admission:'.$admission->id, (string) config('app.key'))
            : $this->scope($event->subject_id, $phone));
        DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $scope, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('edna_router_contacts')->where('scope', $scope)->lockForUpdate()->first();
        $previousQuery = DB::table('edna_flow_sends')->where('scope', $scope);
        if (! $channelEntry) {
            $previousQuery->where('created_at', '>', now()->subHours(24));
        }
        $previous = $previousQuery->latest('id')->first();
        $testStart = config('edna.assistance_start_at');
        $firstTestEntry = $flowId === self::FLOW_ID && $previous && config('edna.assistance_test_mode') && config('edna.assistance_send_enabled')
            && (new EdnaAssistance)->allowed($phone) && $testStart
            && $received->gte(CarbonImmutable::parse($testStart))
            && CarbonImmutable::parse($previous->created_at)->lt(CarbonImmutable::parse($testStart))
            && in_array($previous->state, ['confirmed', 'completed', 'rejected', 'cancelled', 'expired'], true);
        if ($previous && ! $firstTestEntry) {
            $this->record($event->id, 'cooldown', $previous->id);

            return;
        }
        if ($test) {
            $journeyId = $intake->testJourney($phone, $event->subject_id);
            if (! $journeyId) {
                $this->record($event->id, 'test_attribution_unavailable');

                return;
            }
        }
        $entry = $channelEntry ? $intake->freezeEntryAttribution($event, $payload, $journeyId, $flowId) : null;
        $id = DB::table('edna_flow_sends')->insertGetId([
            'request_id' => (string) Str::uuid(), 'entry_event_id' => $event->id,
            'journey_id' => $entry ? $entry['journey_id'] : $journeyId,
            'intake_admission_id' => $admission?->id, 'intake_test' => $test,
            'intake_contract' => $entry ? EdnaIntake::CHANNEL_CONTRACT : null,
            'entry_origin' => $entry['origin'] ?? null,
            'attribution_snapshot' => $entry ? Crypt::encryptString(json_encode($entry['snapshot'], JSON_THROW_ON_ERROR)) : null,
            'scope' => $scope, 'subject_id' => $event->subject_id,
            'cascade_id' => (string) config('edna.cascade_id'), 'flow_id' => $flowId,
            'recipient' => Crypt::encryptString($phone), 'state' => 'pending',
            'entry_received_at' => $received, 'created_at' => now(), 'updated_at' => now(),
        ]);
        Queue::connection('edna')->push(new SendEdnaFlow($id), '', 'edna');
        if ($entry) {
            Queue::connection('edna')->push(new ResolveEdnaIntakeBinding(0, $id), '', 'edna');
        }
        $this->record($event->id, 'scheduled', $id);
    }

    public function correlate(object $event, array $payload, bool $allowDuplicate = false): ?array
    {
        if (($payload['messageContent']['type'] ?? '') !== 'FLOW') {
            return null;
        }
        $request = $payload['replyOutMessageExternalRequestId'] ?? null;
        $outgoing = $payload['replyOutMessageId'] ?? null;
        $transport = app(EdnaFlowTransport::class);
        $found = $request ? $transport->find((string) $request) : null;
        $send = $found ? DB::table('edna_flow_sends')->where('id', $found->id)->lockForUpdate()->first() : null;
        if (! $send || ! $send->recipient || ! $outgoing || $send->subject_id !== $event->subject_id
            || ! $transport->matches($send, (string) $request)
            || ($send->flow_id !== self::FLOW_ID && ! (new EdnaIntake)->canSend($send))
            || ! hash_equals(Crypt::decryptString($send->recipient), $payload['subscriber']['identifier'])) {
            $this->record($event->id, 'unmatched_response');

            return null;
        }
        $received = CarbonImmutable::parse($payload['receivedAt']);
        if (! $send->send_started_at || $received->lt(CarbonImmutable::parse($send->send_started_at)->subMinute())
            || $received->gt(CarbonImmutable::parse($send->created_at)->addHours(24))) {
            $this->record($event->id, 'response_outside_window', $send->id);

            return null;
        }
        if (in_array($send->state, ['sending', 'accepted', 'unknown'], true)) {
            throw new RuntimeException('Edna Flow awaits outgoing history confirmation.');
        }
        if (! in_array($send->state, ['confirmed', 'completed'], true) || $send->outgoing_message_id !== (string) $outgoing) {
            $this->record($event->id, 'unmatched_response', $send->id);

            return null;
        }
        if (! $allowDuplicate && $send->response_event_id && (int) $send->response_event_id !== (int) $event->id) {
            $this->record($event->id, 'duplicate_response', $send->id);

            return null;
        }

        return ['send_id' => (int) $send->id, 'flow_id' => $send->flow_id, 'request_id' => $send->request_id,
            'transport_request_id' => $transport->id($send),
            'outgoing_message_id' => $send->outgoing_message_id, 'verified' => true];
    }

    public function complete(object $event, array $context): void
    {
        $send = DB::table('edna_flow_sends')->where('id', $context['send_id'])->lockForUpdate()->first();
        $transport = app(EdnaFlowTransport::class);
        $expected = $context['transport_request_id'] ?? $context['request_id'] ?? null;
        if (! $send || ! $transport->matches($send, $expected)
            || $send->request_id !== ($context['request_id'] ?? null)
            || $send->outgoing_message_id !== ($context['outgoing_message_id'] ?? null)
            || ! $transport->update($send, ['confirmed', 'completed'], [
                'state' => 'completed', 'response_event_id' => $event->id,
                'completed_at' => now(), 'updated_at' => now(),
            ])) {
            throw new RuntimeException('Edna Flow transport changed before response completion.');
        }
        $this->record($event->id, 'verified_response', $context['send_id']);
    }

    public function record(int $event, string $action, ?int $send = null): void
    {
        DB::table('edna_incoming_events')->where('id', $event)->update(['router_action' => $action, 'flow_send_id' => $send]);
    }
}
