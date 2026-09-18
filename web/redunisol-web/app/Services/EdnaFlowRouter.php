<?php

namespace App\Services;

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

    public function scope(string $subject, string $recipient): string
    {
        return hash_hmac('sha256', $subject.':'.self::FLOW_ID.':'.$recipient, (string) config('app.key'));
    }

    // Caller holds the inbox row lock and commits the ledger + queued job together.
    public function start(object $event, array $payload): void
    {
        if (! config('edna.router_enabled')) {
            $this->record($event->id, 'disabled');

            return;
        }
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
        if ($allowed && ! in_array($phone, $allowed, true)) {
            $this->record($event->id, 'outside_pilot');

            return;
        }
        $scope = $this->scope($event->subject_id, $phone);
        DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $scope, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('edna_router_contacts')->where('scope', $scope)->lockForUpdate()->first();
        $previous = DB::table('edna_flow_sends')->where('scope', $scope)->where('created_at', '>', now()->subHours(24))->latest('id')->first();
        if ($previous) {
            $this->record($event->id, 'cooldown', $previous->id);

            return;
        }
        $id = DB::table('edna_flow_sends')->insertGetId([
            'request_id' => (string) Str::uuid(), 'entry_event_id' => $event->id,
            'scope' => $scope, 'subject_id' => $event->subject_id,
            'cascade_id' => (string) config('edna.cascade_id'), 'flow_id' => self::FLOW_ID,
            'recipient' => Crypt::encryptString($phone), 'state' => 'pending',
            'entry_received_at' => $received, 'created_at' => now(), 'updated_at' => now(),
        ]);
        Queue::connection('edna')->push(new SendEdnaFlow($id), '', 'edna');
        $this->record($event->id, 'scheduled', $id);
    }

    public function correlate(object $event, array $payload): ?array
    {
        if (($payload['messageContent']['type'] ?? '') !== 'FLOW') {
            return null;
        }
        $request = $payload['replyOutMessageExternalRequestId'] ?? null;
        $outgoing = $payload['replyOutMessageId'] ?? null;
        $send = $request ? DB::table('edna_flow_sends')->where('request_id', $request)->lockForUpdate()->first() : null;
        if (! $send || ! $send->recipient || ! $outgoing || $send->subject_id !== $event->subject_id
            || $send->flow_id !== self::FLOW_ID
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
        if ($send->response_event_id && (int) $send->response_event_id !== (int) $event->id) {
            $this->record($event->id, 'duplicate_response', $send->id);

            return null;
        }

        return ['send_id' => (int) $send->id, 'flow_id' => $send->flow_id, 'request_id' => $send->request_id,
            'outgoing_message_id' => $send->outgoing_message_id, 'verified' => true];
    }

    public function complete(object $event, array $context): void
    {
        DB::table('edna_flow_sends')->where('id', $context['send_id'])->update([
            'state' => 'completed', 'response_event_id' => $event->id,
            'completed_at' => now(), 'updated_at' => now(),
        ]);
        $this->record($event->id, 'verified_response', $context['send_id']);
    }

    public function record(int $event, string $action, ?int $send = null): void
    {
        DB::table('edna_incoming_events')->where('id', $event)->update(['router_action' => $action, 'flow_send_id' => $send]);
    }
}
