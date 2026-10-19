<?php

use App\Jobs\EvaluateEdnaOutOfHours;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaOutOfHours;
use App\Services\EdnaOutOfHoursPolicy;
use App\Support\WhatsAppOutOfHoursSettings;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-10-16T10:00:00-03:00')->utc());
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('edna', ['enabled' => true, 'out_of_hours_enabled' => true,
        'out_of_hours_recipients' => [], 'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/policy']);
    $settings = new WhatsAppOutOfHoursSettings;
    $settings->save(array_replace($settings->defaults(), ['enabled' => true]));
    Http::preventStrayRequests();
    Http::fake(['kestra.example.test/*' => function ($request) {
        return config('testing.recovery_policy_fail') ? Http::response([], 503)
            : Http::response(['ok' => true, 'kind' => 'out_of_hours_policy',
                'policy_version' => EdnaOutOfHoursPolicy::VERSION, 'request_id' => $request['request_id'],
                'event_key' => $request['event_key'], 'decision' => 'suppress', 'reason' => 'business_hours_or_expired']);
    }]);
});

function recoveryEvent(array $overrides = []): array
{
    $payload = array_replace(['subscriber' => ['identifier' => '5493511234567'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Hola']], $overrides);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => (string) Str::uuid(),
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'out_of_hours_candidate' => true,
        'created_at' => now()->subMinutes(10), 'updated_at' => now()->subMinutes(10), 'delivered_at' => now()->subMinutes(10)]);

    return [DB::table('edna_incoming_events')->find($id), $payload];
}

function recoveryRoute(object $event, array $payload, string $route, string $request, string $message): void
{
    $scope = (new EdnaFlowRouter)->scope('2423', $payload['subscriber']['identifier']);
    if ($route === 'form') {
        $hash = (new AttributionJourney)->phoneHash($payload['subscriber']['identifier']);
        DB::table('edna_form_link_sends')->insert(['scope' => hash('sha256', '2423:'.$hash),
            'entry_event_id' => $event->id, 'request_id' => $request, 'outgoing_message_id' => $message,
            'subject_id' => '2423', 'cascade_id' => '2557', 'crm_entity' => 'contact', 'crm_id' => '123',
            'state' => 'confirmed', 'created_at' => now(), 'updated_at' => now()]);

        return;
    }
    $flow = DB::table('edna_flow_sends')->insertGetId(['scope' => $scope, 'entry_event_id' => $event->id,
        'request_id' => $route === 'flow' ? $request : (string) Str::uuid(),
        'outgoing_message_id' => $route === 'flow' ? $message : null, 'subject_id' => '2423', 'cascade_id' => '2557',
        'flow_id' => '1850162769693486', 'state' => 'expired', 'entry_received_at' => now(),
        'created_at' => now(), 'updated_at' => now()]);
    if ($route === 'landing') {
        DB::table('edna_router_results')->insert(['flow_send_id' => $flow, 'response_event_id' => $event->id,
            'province' => 'Cordoba', 'situation' => 'policia', 'segment' => 'empleado', 'landing_url' => 'test',
            'message_text' => 'test', 'response_received_at' => now(), 'request_id' => $request,
            'outgoing_message_id' => $message, 'state' => 'confirmed', 'created_at' => now(), 'updated_at' => now()]);
    }
}

function popRecoveryEvaluation(): array
{
    $job = Queue::connection('edna')->pop('edna');
    $command = unserialize($job->payload()['data']['command']);
    $command->setJob($job);

    return [$job, $command];
}

test('foreign non UUID references do not interrupt evaluation', function () {
    [$event, $payload] = recoveryEvent(['replyOutMessageExternalRequestId' => '0ad00d0000cf00.00000000',
        'replyOutMessageId' => '987654321']);
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
    (new EvaluateEdnaOutOfHours($event->id))->handle();
    expect(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluated_at)->not->toBeNull();
    expect(DB::table('edna_out_of_hours_sends')->count())->toBe(0);
});

test('valid UUID references still suppress replies to our automated routes', function (string $route) {
    $request = (string) Str::uuid();
    [$event, $payload] = recoveryEvent(['replyOutMessageExternalRequestId' => $request]);
    recoveryRoute($event, $payload, $route, $request, '987654321');
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeTrue();
    $payload['subscriber']['identifier'] = '5493519999999';
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
})->with(['flow', 'landing', 'form']);

test('foreign references preserve matching by outgoing message ID and person', function (string $route) {
    [$event, $payload] = recoveryEvent(['replyOutMessageExternalRequestId' => '0ad00d0000cf00.00000000',
        'replyOutMessageId' => '987654321']);
    recoveryRoute($event, $payload, $route, (string) Str::uuid(), '987654321');
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeTrue();
    $payload['subscriber']['identifier'] = '5493519999999';
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
})->with(['flow', 'landing', 'form']);

test('foreign references without a message ID are ordinary candidates', function () {
    [$event, $payload] = recoveryEvent(['replyOutMessageExternalRequestId' => '0ad00d0000cf00.00000000']);
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
});

test('recovery does not enqueue another evaluation during queue backoff', function () {
    [$event] = recoveryEvent();
    expect(EvaluateEdnaOutOfHours::enqueue($event->id))->toBeTrue();
    [$queued, $command] = popRecoveryEvaluation();
    $owner = $command->evaluationId;
    config()->set('testing.recovery_policy_fail', true);
    expect(fn () => $command->handle())->toThrow(RuntimeException::class);
    $queued->release(1800);
    $this->travel(10)->minutes();
    $this->artisan('edna:out-of-hours recover --apply')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(1)
        ->and(DB::table('jobs')->first()->available_at)->toBeGreaterThan(now()->timestamp)
        ->and(EvaluateEdnaOutOfHours::enqueue($event->id))->toBeFalse();
    $this->travel(20)->minutes();
    config()->set('testing.recovery_policy_fail', false);
    [$retry, $retried] = popRecoveryEvaluation();
    expect($retried->evaluationId)->toBe($owner);
    $retried->handle();
    $retry->delete();
    expect(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluated_at)->not->toBeNull();
});

test('evaluation ownership and queue insertion roll back together', function () {
    [$event] = recoveryEvent();
    DB::beginTransaction();
    EvaluateEdnaOutOfHours::enqueue($event->id);
    DB::rollBack();
    expect(DB::table('jobs')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluation_id)->toBeNull();
    expect(EvaluateEdnaOutOfHours::enqueue($event->id))->toBeTrue();
});

test('exhausted evaluations require explicit retry and old jobs cannot reclaim them', function () {
    [$event] = recoveryEvent();
    EvaluateEdnaOutOfHours::enqueue($event->id);
    [$queued, $command] = popRecoveryEvaluation();
    $queued->delete();
    $command->failed(new RuntimeException('test'));
    $this->artisan('edna:out-of-hours recover --apply')->expectsOutputToContain('Evaluations requiring review: 1')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(0);
    $this->artisan('edna:out-of-hours recover --apply --retry-failed-evaluations')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(1);
    $fresh = DB::table('edna_incoming_events')->find($event->id);
    expect($fresh->out_of_hours_evaluation_id)->not->toBe($command->evaluationId)
        ->and($fresh->out_of_hours_evaluation_failed_at)->toBeNull();
    $command->failed(new RuntimeException('old duplicate'));
    $command->handle();
    expect(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluation_failed_at)->toBeNull();
    Http::assertNothingSent();
    [$retry, $retried] = popRecoveryEvaluation();
    $retried->handle();
    $retry->delete();
    expect(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluated_at)->not->toBeNull();
});

test('legacy duplicate jobs share one owner across release and are drained as no ops', function () {
    [$event] = recoveryEvent();
    Queue::connection('edna')->push(new EvaluateEdnaOutOfHours($event->id), '', 'edna');
    Queue::connection('edna')->push(new EvaluateEdnaOutOfHours($event->id), '', 'edna');
    [$first, $command] = popRecoveryEvaluation();
    config()->set('testing.recovery_policy_fail', true);
    expect(fn () => $command->handle())->toThrow(RuntimeException::class);
    $uuid = $first->uuid();
    $first->release(600);
    [$duplicate, $copy] = popRecoveryEvaluation();
    $copy->handle();
    $duplicate->delete();
    Http::assertSentCount(1);
    $this->artisan('edna:out-of-hours recover --apply')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(1);
    $this->travel(10)->minutes();
    config()->set('testing.recovery_policy_fail', false);
    [$retry, $retried] = popRecoveryEvaluation();
    expect($retry->uuid())->toBe($uuid);
    $retried->handle();
    $retry->delete();
    expect(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluated_at)->not->toBeNull();
});

test('recovery leaves expired and already evaluated events alone', function () {
    [$old] = recoveryEvent();
    DB::table('edna_incoming_events')->where('id', $old->id)->update(['delivered_at' => now()->subHours(24)]);
    [$done] = recoveryEvent();
    DB::table('edna_incoming_events')->where('id', $done->id)->update(['out_of_hours_evaluated_at' => now()]);
    $this->artisan('edna:out-of-hours recover --apply')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(0);
});

test('ordinary messages after completing a Flow remain excluded from notices', function () {
    [$event, $payload] = recoveryEvent();
    recoveryRoute($event, $payload, 'flow', (string) Str::uuid(), '987654321');
    DB::table('edna_flow_sends')->update(['state' => 'completed', 'completed_at' => now()->subMinute()]);
    // No reply reference: the completed Flow itself must suppress the new text.
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeTrue();
    $payload['subscriber']['identifier'] = '5493519999999';
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
    $payload['subscriber']['identifier'] = '5493511234567';
    $event->subject_id = 'other-channel';
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
});

test('completed Flows retain the existing twenty four hour exclusion limit', function () {
    [$event, $payload] = recoveryEvent();
    recoveryRoute($event, $payload, 'flow', (string) Str::uuid(), '987654321');
    DB::table('edna_flow_sends')->update(['state' => 'completed', 'created_at' => now()->subHours(24)]);
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
});
