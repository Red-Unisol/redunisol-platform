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
        $this->reserve($event, $payload);
    }

    public function startPaidEntry(object $event, array $payload, array $decision): ?int
    {
        return DB::transaction(function () use ($event, $payload, $decision): ?int {
            $marker = (new EdnaPaidFlowGuard)->marker($decision, (int) $event->id);
            $entry = DB::table('edna_incoming_events')->where('id', $event->id)->lockForUpdate()->first();
            try {
                $stored = $this->organicEventPayload($entry, (string) config('edna.subject_id'), (string) ($payload['subscriber']['identifier'] ?? ''));
            } catch (\Throwable) {
                return null;
            }
            if (! $marker || ! $stored || $entry->subject_id !== $event->subject_id
                || ($payload['id'] ?? null) !== $entry->message_id || ! (new EdnaIntake)->salesChannelEntry($entry, $stored)) {
                return null;
            }
            $existing = DB::table('edna_flow_sends')->where('entry_event_id', $entry->id)->first();
            if ($existing) {
                try {
                    $snapshot = json_decode(Crypt::decryptString($existing->attribution_snapshot ?? ''), true, 32, JSON_THROW_ON_ERROR);

                    return ($snapshot['entry_routing'] ?? null) === $marker ? (int) $existing->id : null;
                } catch (\Throwable) {
                    return null;
                }
            }

            return $this->reserve($entry, $stored, null, $marker);
        }, 5);
    }

    public function startOrganicChoice(int $menuId): ?int
    {
        return DB::transaction(function () use ($menuId): ?int {
            $menu = DB::table('edna_organic_menus')->where('id', $menuId)->lockForUpdate()->first();
            if (! $menu || $menu->state !== 'selected' || $menu->choice !== 'loan'
                || $menu->send_state !== 'confirmed' || ! Str::isUuid($menu->request_id)
                || (int) $menu->entry_event_id < 1 || (int) $menu->choice_event_id < 1
                || (int) $menu->entry_event_id === (int) $menu->choice_event_id
                || $menu->subject_id !== (string) config('edna.subject_id')) {
                return null;
            }
            $entry = DB::table('edna_incoming_events')->where('id', $menu->entry_event_id)->lockForUpdate()->first();
            $choice = DB::table('edna_incoming_events')->where('id', $menu->choice_event_id)->lockForUpdate()->first();
            try {
                $phone = Crypt::decryptString($menu->recipient ?? '');
                $payload = $this->organicEventPayload($entry, $menu->subject_id, $phone);
                $choicePayload = $this->organicEventPayload($choice, $menu->subject_id, $phone);
            } catch (\Throwable) {
                return null;
            }
            if (! $payload || ! $choicePayload || ! (new EdnaIntake)->salesChannelEntry($entry, $payload)) {
                return null;
            }
            $scope = hash_hmac('sha256', 'organic-menu:'.$menu->request_id, (string) config('app.key'));
            if ($menu->flow_send_id) {
                $send = DB::table('edna_flow_sends')->where('id', $menu->flow_send_id)->lockForUpdate()->first();
                try {
                    return $send && $send->scope === $scope && (int) $send->entry_event_id === (int) $entry->id
                        && $send->subject_id === $menu->subject_id && $send->recipient
                        && hash_equals($phone, Crypt::decryptString($send->recipient)) ? (int) $send->id : null;
                } catch (\Throwable) {
                    return null;
                }
            }
            // One authenticated entry cannot become two separate Flow cases.
            if (DB::table('edna_flow_sends')->where('entry_event_id', $entry->id)->exists()) {
                return null;
            }
            $sendId = $this->reserve($entry, $payload, $menu->request_id);
            if ($sendId !== null) {
                DB::table('edna_organic_menus')->where('id', $menu->id)->update([
                    'flow_send_id' => $sendId, 'updated_at' => now(),
                ]);
            }

            return $sendId;
        }, 5);
    }

    private function organicEventPayload(?object $event, string $subject, string $phone): ?array
    {
        if (! $event || $event->subject_id !== $subject || ! preg_match('/^[0-9]{10,15}$/D', $phone)
            || ! preg_match('/^[0-9]{1,64}$/D', $event->message_id)) {
            return null;
        }
        $payload = json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
        if (! is_array($payload) || ($payload['id'] ?? null) !== $event->message_id
            || ($payload['subjectId'] ?? null) !== $subject
            || ! hash_equals($phone, (string) ($payload['subscriber']['identifier'] ?? ''))
            || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', (string) ($payload['receivedAt'] ?? ''))) {
            return null;
        }
        CarbonImmutable::parse($payload['receivedAt']);

        return $payload;
    }

    private function reserve(object $event, array $payload, ?string $organicRequestId = null, ?array $paidRouting = null): ?int
    {
        if (! config('edna.router_enabled')) {
            $this->record($event->id, 'disabled');

            return null;
        }
        $intake = new EdnaIntake;
        $text = (string) ($payload['messageContent']['text'] ?? '');
        $test = $intake->isTestEntry($text);
        $channelEntry = $intake->salesChannelEntry($event, $payload);
        $journeyId = $test ? null : (new AttributionJourney)->bind($text,
            (string) $payload['subscriber']['identifier'], (string) $event->subject_id);
        if (($paidRouting['evidence']['kind'] ?? '') === 'tracked_paid_click'
            && (! $journeyId || ($paidRouting['evidence']['journey_id'] ?? null) !== $journeyId)) {
            $this->record($event->id, 'paid_attribution_unavailable');

            return null;
        }
        $received = CarbonImmutable::parse($payload['receivedAt']);
        $start = config('edna.router_start_at');
        if (! $start || ! config('edna.api_key') || ! preg_match('/^[0-9]+$/D', (string) config('edna.cascade_id'))) {
            throw new RuntimeException('Edna router configuration is incomplete.');
        }
        if ($received->lt(CarbonImmutable::parse($start))) {
            $this->record($event->id, 'before_activation');

            return null;
        }
        if ($received->lt(now()->subHours(23)) || $received->gt(now()->addMinutes(5))) {
            $this->record($event->id, 'outside_send_window');

            return null;
        }
        $phone = $payload['subscriber']['identifier'];
        if (! preg_match('/^[0-9]{10,15}$/D', $phone)) {
            $this->record($event->id, 'unsupported_recipient');

            return null;
        }
        $allowed = config('edna.router_recipients', []);
        if (! $test && $allowed && ! in_array($phone, $allowed, true)) {
            $this->record($event->id, 'outside_pilot');

            return null;
        }
        if ($test && (! config('edna.intake_enabled') || ! $intake->flowId())) {
            $this->record($event->id, 'test_intake_unconfigured');

            return null;
        }
        // Both entry paths share this lock; distinct organic menus for a phone
        // cannot reserve two active Flows concurrently.
        $recipientScope = hash_hmac('sha256', 'flow-recipient:'.$event->subject_id.':'.$phone, (string) config('app.key'));
        DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $recipientScope, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('edna_router_contacts')->where('scope', $recipientScope)->lockForUpdate()->first();
        $specialScope = $paidRouting !== null
            ? hash_hmac('sha256', 'paid-entry:'.$event->id, (string) config('app.key'))
            : ($organicRequestId !== null ? hash_hmac('sha256', 'organic-menu:'.$organicRequestId, (string) config('app.key')) : null);
        if ($specialScope !== null && $this->hasActiveFlow($event->subject_id, $phone, $specialScope, $paidRouting !== null)) {
            $this->record($event->id, $paidRouting !== null ? 'paid_active_flow' : 'organic_active_flow');

            return null;
        }
        $admission = $test ? null : $intake->admit($event->subject_id, $phone, $journeyId, $received, $channelEntry);
        if ($channelEntry && ! $admission) {
            $this->record($event->id, 'intake_admission_unavailable');

            return null;
        }
        $flowId = $test ? $intake->flowId() : ($admission?->flow_id ?? self::FLOW_ID);
        if ($specialScope !== null && $flowId !== $intake->flowId()) {
            $this->record($event->id, $paidRouting !== null ? 'paid_flow_contract_changed' : 'organic_flow_contract_changed');

            return null;
        }
        $scope = $specialScope !== null
            ? $specialScope
            : ($test
            ? hash_hmac('sha256', 'intake-test-entry:'.$event->id, (string) config('app.key'))
            : ($admission
            ? hash_hmac('sha256', 'intake-admission:'.$admission->id, (string) config('app.key'))
            : $this->scope($event->subject_id, $phone)));
        DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $scope, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('edna_router_contacts')->where('scope', $scope)->lockForUpdate()->first();
        $previousQuery = DB::table('edna_flow_sends')->where('scope', $scope);
        if (! $channelEntry && $specialScope === null) {
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

            return null;
        }
        if ($test) {
            $journeyId = $intake->testJourney($phone, $event->subject_id);
            if (! $journeyId) {
                $this->record($event->id, 'test_attribution_unavailable');

                return null;
            }
        }
        $entry = $channelEntry ? $intake->freezeEntryAttribution($event, $payload, $journeyId, $flowId) : null;
        if (($paidRouting['evidence']['kind'] ?? '') === 'tracked_paid_click'
            && (($entry['snapshot']['status'] ?? '') !== 'resolved'
                || ($entry['snapshot']['journey_id'] ?? null) !== ($paidRouting['evidence']['journey_id'] ?? null))) {
            $this->record($event->id, 'paid_attribution_unavailable');

            return null;
        }
        if ($paidRouting !== null && $entry) {
            $entry['snapshot']['entry_routing'] = $paidRouting;
        }
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
        if ($paidRouting !== null && $entry) {
            Queue::connection('edna')->push(new ResolveEdnaIntakeBinding(0, $id), '', 'edna');
        }
        Queue::connection('edna')->push(new SendEdnaFlow($id), '', 'edna');
        if ($entry && $paidRouting === null) {
            Queue::connection('edna')->push(new ResolveEdnaIntakeBinding(0, $id), '', 'edna');
        }
        $this->record($event->id, 'scheduled', $id);

        return $id;
    }

    private function hasActiveFlow(string $subject, string $phone, string $scope, bool $allowExpiredConfirmed = false): bool
    {
        $hash = (new AttributionJourney)->phoneHash($phone);
        $admissions = DB::table('edna_intake_admissions as a')
            ->join('edna_intake_pilots as p', 'p.id', '=', 'a.pilot_key')
            ->where('p.subject_id', $subject)->where('a.recipient_hash', $hash)->pluck('a.id')->all();
        $active = DB::table('edna_flow_sends')->where('subject_id', $subject)->where('scope', '!=', $scope)
            ->whereIn('state', ['pending', 'sending', 'accepted', 'unknown', 'confirmed'])->get();
        foreach ($active as $send) {
            if ($allowExpiredConfirmed && $send->state === 'confirmed') {
                try {
                    if (CarbonImmutable::parse($send->entry_received_at)->lt(now()->subHours(23))) {
                        continue;
                    }
                } catch (\Throwable) {
                    return true;
                }
            }
            if (in_array($send->intake_admission_id, $admissions, false)
                || hash_equals($send->scope, $this->scope($subject, $phone, $send->flow_id))) {
                return true;
            }
            try {
                if ($send->recipient && hash_equals($phone, Crypt::decryptString($send->recipient))) {
                    return true;
                }
            } catch (\Throwable) {
                // Unreadable active transport identity requires review.
                return true;
            }
        }

        return false;
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
