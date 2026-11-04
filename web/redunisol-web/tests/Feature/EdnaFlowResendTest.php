<?php

use App\Jobs\ProcessEdnaIntake;
use App\Jobs\ReconcileEdnaFlow;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowResend;
use App\Services\EdnaFlowTransport;
use App\Services\EdnaIntake;
use App\Services\EdnaIntakeBinding;
use App\Services\EdnaIntakePilot;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 4)->setTime(18, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('s', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'router_enabled' => true,
        'subject_id' => '2423', 'cascade_id' => '2557', 'api_key' => 'resend-fixture-key',
        'router_recipients' => [], 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '950118281197789', 'intake_start_at' => now()->subDay()->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'controlled-resend-test', 'intake_pilot_limit' => 'unlimited',
        'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/test']);
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Queue::fake();
});

function controlledResendFixture(bool $legacy = false): object
{
    $journeys = new AttributionJourney;
    $journey = $journeys->create(['version' => 1, 'first' => ['utm_source' => 'ig'], 'last' => ['utm_source' => 'ig']]);
    $journeyId = $journeys->bind('(ref: '.$journey->id.')', '5493510000000', '2423');
    $payload = ['id' => '810001', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->subMinutes(6)->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta (ref: '.$journeyId.')']];
    $entryId = DB::table('edna_incoming_events')->insertGetId([
        'subject_id' => '2423', 'message_id' => '810001', 'payload' => Crypt::encryptString(json_encode($payload)),
        'status' => 'delivered', 'created_at' => now()->subMinutes(6), 'updated_at' => now()->subMinutes(6),
    ]);
    $admission = (new EdnaIntakePilot)->reserve('2423', '5493510000000', '950118281197789', true);
    $entry = DB::table('edna_incoming_events')->find($entryId);
    $frozen = (new EdnaIntake)->freezeEntryAttribution($entry, $payload, $journeyId, '950118281197789');
    $sendId = DB::table('edna_flow_sends')->insertGetId([
        'request_id' => '5c9a19e8-700f-481f-84d0-09c99c25e271', 'entry_event_id' => $entryId,
        'scope' => hash_hmac('sha256', 'intake-admission:'.$admission->id, config('app.key')),
        'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => '950118281197789',
        'recipient' => Crypt::encryptString('5493510000000'), 'journey_id' => $journeyId,
        'intake_admission_id' => $admission->id, 'intake_test' => false,
        'intake_contract' => $legacy ? null : EdnaIntake::CHANNEL_CONTRACT,
        'entry_origin' => $legacy ? null : $frozen['origin'],
        'attribution_snapshot' => $legacy ? null : Crypt::encryptString(json_encode($frozen['snapshot'])),
        'state' => 'rejected', 'reason' => 'outgoing_not_delivered', 'outgoing_message_id' => '9001',
        'entry_received_at' => now()->subMinutes(6), 'send_started_at' => now()->subMinutes(3),
        'accepted_at' => now()->subMinutes(3), 'created_at' => now()->subMinutes(5), 'updated_at' => now()->subMinute(),
    ]);
    $proof = ['version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
        'lead_id' => '700', 'chat_id' => '701', 'session_id' => '702', 'message_id' => '703',
        'entry_event_id' => $entryId, 'entry_message_id' => '810001', 'evidence' => 'external_message_id'];
    DB::table('edna_intake_bindings')->insert([
        'flow_send_id' => $sendId, 'case_id' => '5c9a19e8-700f-481f-84d0-09c99c25e271',
        'entry_event_id' => $entryId, 'state' => 'verified', 'lead_id' => '700', 'proof' => json_encode($proof),
        'verified_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);

    return DB::table('edna_flow_sends')->find($sendId);
}

function controlledResendMessage(object $send, array $changes = []): array
{
    return array_replace(['messageId' => '9001', 'comment' => $send->request_id,
        'direction' => 'OUT', 'channelType' => 'WHATSAPP', 'subjectId' => 2423, 'cascadeId' => 2557,
        'address' => '5493510000000', 'deliveryStatus' => 'FAILED', 'content' => '{}',
        'deliveryStatusMessage' => 'insufficient balance'], $changes);
}

function controlledResendHistory(array $messages, bool $hasNext = false): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake([
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
            'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/messages/history' => Http::response(['content' => $messages, 'hasNext' => $hasNext]),
    ]);
}

function controlledResendApply(object $send, array $changes = []): array
{
    $values = array_replace(['case' => $send->request_id, 'lead' => '700', 'mid' => '9001',
        'operation' => '13031311-23b4-43f5-9368-74f3cf4fdd61', 'confirmed' => true], $changes);

    return (new EdnaFlowResend)->apply($send->id, $values['case'], $values['lead'], $values['mid'],
        $values['operation'], $values['confirmed']);
}

function controlledResendImmutable(object $send): array
{
    return array_intersect_key((array) $send, array_flip([
        'id', 'request_id', 'entry_event_id', 'scope', 'subject_id', 'cascade_id', 'flow_id', 'recipient',
        'journey_id', 'intake_admission_id', 'entry_received_at', 'created_at',
    ]));
}

test('controlled resend preview leaves the original case and capacity untouched', function () {
    $send = controlledResendFixture(true);
    controlledResendHistory([controlledResendMessage($send)]);
    $before = (array) $send;
    $binding = (array) DB::table('edna_intake_bindings')->first();

    $preview = (new EdnaFlowResend)->preview($send->id);

    expect($preview['send_id'])->toBe($send->id)
        ->and((array) DB::table('edna_flow_sends')->find($send->id))->toBe($before)
        ->and((array) DB::table('edna_intake_bindings')->first())->toBe($binding)
        ->and(DB::table('edna_flow_send_attempts')->count())->toBe(0)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});

test('one approved resend archives the failed attempt and preserves its canonical case and lead', function (bool $legacy) {
    $send = controlledResendFixture($legacy);
    controlledResendHistory([controlledResendMessage($send)]);
    $before = controlledResendImmutable($send);
    $binding = (array) DB::table('edna_intake_bindings')->first();
    $slot = (array) DB::table('edna_intake_admissions')->first();

    controlledResendApply($send);
    $active = DB::table('edna_flow_sends')->find($send->id);
    $attempts = DB::table('edna_flow_send_attempts')->orderBy('attempt_no')->get();

    expect(controlledResendImmutable($active))->toBe($before)
        ->and($active->transport_request_id)->not->toBe($send->request_id)
        ->and($active->state)->toBe('pending')->and($active->outgoing_message_id)->toBeNull()
        ->and($active->intake_contract)->toBe(EdnaIntake::CHANNEL_CONTRACT)
        ->and($attempts)->toHaveCount(2)
        ->and($attempts[0]->transport_request_id)->toBe($send->request_id)
        ->and($attempts[0]->state)->toBe('rejected')->and($attempts[0]->outgoing_message_id)->toBe('9001')
        ->and($attempts[1]->transport_request_id)->toBe($active->transport_request_id)
        ->and($attempts[1]->operation_id)->toBe('13031311-23b4-43f5-9368-74f3cf4fdd61')
        ->and($attempts[1]->expected_lead_id)->toBe('700')
        ->and((array) DB::table('edna_intake_admissions')->first())->toBe($slot)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_bindings')->first()->lead_id)->toBe($binding['lead_id'])
        ->and(DB::table('edna_intake_bindings')->first()->case_id)->toBe($binding['case_id']);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
})->with([true, false]);

test('repeating the same operation is idempotent and a distinct second resend is forbidden', function () {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    controlledResendApply($send);
    $alias = DB::table('edna_flow_sends')->find($send->id)->transport_request_id;
    controlledResendApply($send);

    expect(DB::table('edna_flow_send_attempts')->count())->toBe(2)
        ->and(DB::table('edna_flow_sends')->find($send->id)->transport_request_id)->toBe($alias);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    expect(fn () => controlledResendApply($send, ['operation' => '8dac671c-c79f-405b-810f-984f809fae63']))
        ->toThrow(RuntimeException::class);
    Queue::assertPushed(SendEdnaFlow::class, 1);
});

test('operator reconciliation uses the active resend alias without sending another message', function () {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    controlledResendApply($send);
    $active = DB::table('edna_flow_sends')->find($send->id);
    app(EdnaFlowTransport::class)->update($active, ['pending'], ['state' => 'unknown']);

    $this->artisan('edna:router', ['action' => 'reconcile', 'id' => $send->id])->assertSuccessful();

    Queue::assertPushed(ReconcileEdnaFlow::class, fn ($job) => $job->sendId === $send->id
        && $job->transportRequestId === $active->transport_request_id);
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});

test('idempotency cannot acknowledge the same operation with different case lead or failed message evidence', function (string $field) {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    controlledResendApply($send);
    $changes = [$field => $field === 'case' ? '8dac671c-c79f-405b-810f-984f809fae63' : '999'];

    expect(fn () => controlledResendApply($send, $changes))->toThrow(RuntimeException::class)
        ->and(DB::table('edna_flow_send_attempts')->count())->toBe(2);
    Queue::assertPushed(SendEdnaFlow::class, 1);
})->with(['case', 'lead', 'mid']);

test('missing or different original binding rolls back legacy promotion and never queues the replacement', function (bool $missing) {
    $send = controlledResendFixture(true);
    controlledResendHistory([controlledResendMessage($send)]);
    $proof = $missing ? null : json_decode(DB::table('edna_intake_bindings')->first()->proof, true);
    if ($proof !== null) {
        $proof['lead_id'] = '999';
    }
    $resolver = Mockery::mock(EdnaIntakeBinding::class);
    $resolver->shouldReceive('resolve')->once()->andReturn($proof);
    app()->instance(EdnaIntakeBinding::class, $resolver);

    expect(fn () => controlledResendApply($send))->toThrow(RuntimeException::class)
        ->and(DB::table('edna_flow_send_attempts')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->find($send->id)->intake_contract)->toBeNull()
        ->and(DB::table('edna_flow_sends')->find($send->id)->transport_request_id)->toBeNull()
        ->and(DB::table('edna_intake_bindings')->first()->lead_id)->toBe('700')
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Queue::assertNotPushed(SendEdnaFlow::class);
})->with([true, false]);

test('a resend requires complete exact FAILED history rather than an assumed nondelivery', function (array $change, bool $hasNext, bool $duplicate) {
    $send = controlledResendFixture();
    $messages = [controlledResendMessage($send, $change)];
    if ($duplicate) {
        $messages[] = controlledResendMessage($send, ['messageId' => '9009']);
    }
    controlledResendHistory($messages, $hasNext);

    expect(fn () => controlledResendApply($send))->toThrow(RuntimeException::class)
        ->and(DB::table('edna_flow_send_attempts')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('rejected');
    Queue::assertNotPushed(SendEdnaFlow::class);
})->with([
    'sent' => [['deliveryStatus' => 'SENT'], false, false],
    'unknown' => [['deliveryStatus' => 'ACCEPTED'], false, false],
    'different uuid' => [['comment' => '13031311-23b4-43f5-9368-74f3cf4fdd61'], false, false],
    'different subject' => [['subjectId' => 9999], false, false],
    'different cascade' => [['cascadeId' => 9999], false, false],
    'different recipient' => [['address' => '5493519999999'], false, false],
    'different mid' => [['messageId' => '9009'], false, false],
    'incomplete page' => [[], true, false],
    'ambiguous uuid' => [[], false, true],
]);

test('responses identity changes missing confirmation and expired windows prevent a resend', function (string $guard) {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    $changes = [];
    match ($guard) {
        'response' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['response_event_id' => 999]),
        'request' => DB::table('edna_intake_requests')->insert(['flow_send_id' => $send->id, 'response_event_id' => 999,
            'answer' => Crypt::encryptString('{}'), 'received_at' => now(), 'state' => 'review', 'created_at' => now(), 'updated_at' => now()]),
        'unknown' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'unknown']),
        'expired' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['entry_received_at' => now()->subHours(23)]),
        'case' => $changes = ['case' => '13031311-23b4-43f5-9368-74f3cf4fdd61'],
        'lead' => $changes = ['lead' => '999'],
        'mid' => $changes = ['mid' => '999'],
        'confirmation' => $changes = ['confirmed' => false],
    };

    expect(fn () => controlledResendApply($send, $changes))->toThrow(RuntimeException::class)
        ->and(DB::table('edna_flow_send_attempts')->count())->toBe(0);
    Queue::assertNotPushed(SendEdnaFlow::class);
})->with(['response', 'request', 'unknown', 'expired', 'case', 'lead', 'mid', 'confirmation']);

test('stale original jobs and stale updates cannot send or degrade the active replacement', function () {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    controlledResendApply($send);
    $active = DB::table('edna_flow_sends')->find($send->id);

    (new SendEdnaFlow($send->id))->handle();
    (new SendEdnaFlow($send->id))->failed(new RuntimeException('old worker interrupted'));
    (new ReconcileEdnaFlow($send->id))->handle();
    (new ReconcileEdnaFlow($send->id))->failed(new RuntimeException('old history worker interrupted'));

    $transport = app(EdnaFlowTransport::class);
    expect($transport->update($send, ['rejected'], ['state' => 'failed', 'reason' => 'stale_worker']))->toBeFalse()
        ->and($transport->find($send->request_id))->toBeNull()
        ->and($transport->find($active->transport_request_id)->request_id)->toBe($send->request_id)
        ->and(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('pending')
        ->and(DB::table('edna_flow_send_attempts')->where('attempt_no', 2)->value('state'))->toBe('pending');
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});

test('only the active alias is sent reconciled and accepted while CRM receives the original case uuid', function () {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    controlledResendApply($send);
    $active = DB::table('edna_flow_sends')->find($send->id);
    controlledResendHistory([controlledResendMessage($send),
        controlledResendMessage($send, ['messageId' => '9002', 'comment' => $active->transport_request_id,
            'deliveryStatus' => 'SENT', 'content' => ['type' => 'FLOW', 'flowId' => '950118281197789']])]);
    Http::fake([
        'app.edna.io/api/cascade/schedule' => fn ($request) => Http::response(['requestId' => $request['requestId']]),
    ]);
    (new SendEdnaFlow($send->id, $active->transport_request_id))->handle();
    (new ReconcileEdnaFlow($send->id, $active->transport_request_id))->handle();
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule')
        && $request['requestId'] === $active->transport_request_id && $request['comment'] === $active->transport_request_id);
    expect(DB::table('edna_flow_sends')->find($send->id)->outgoing_message_id)->toBe('9002')
        ->and(DB::table('edna_flow_send_attempts')->where('attempt_no', 1)->value('state'))->toBe('rejected')
        ->and(DB::table('edna_flow_send_attempts')->where('attempt_no', 1)->value('outgoing_message_id'))->toBe('9001');

    $makeReply = function (string $alias, string $mid, string $eventMid) {
        $payload = ['id' => $eventMid, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
            'receivedAt' => now()->toIso8601String(), 'replyOutMessageExternalRequestId' => $alias, 'replyOutMessageId' => $mid,
            'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => 'catamarca',
                'situacion_catamarca' => 'policia', 'banco_catamarca' => 'nacion', 'cuil' => '20301234563'])]];
        $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $eventMid,
            'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);

        return [DB::table('edna_incoming_events')->find($id), $payload];
    };
    [$oldEvent, $oldPayload] = $makeReply($send->request_id, '9001', '810002');
    expect((new EdnaIntake)->receive($oldEvent, $oldPayload))->toBeFalse()
        ->and(DB::table('edna_intake_requests')->count())->toBe(0);
    [$event, $payload] = $makeReply($active->transport_request_id, '9002', '810003');
    expect((new EdnaIntake)->receive($event, $payload))->toBeTrue();
    $request = DB::table('edna_intake_requests')->first();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'pending']);
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($request) => Http::response([
        'ok' => true, 'case_id' => $request['case_id'], 'action' => 'queued', 'lead_id' => '700', 'contact_id' => '800',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();

    Http::assertSent(fn ($request) => str_starts_with($request->url(), 'https://kestra.example.test/')
        && $request['case_id'] === $send->request_id && $request['contract'] === EdnaIntake::CHANNEL_CONTRACT
        && $request['crm_binding']['lead_id'] === '700');
    expect(DB::table('edna_intake_requests')->count())->toBe(1)
        ->and(DB::table('edna_intake_requests')->first()->lead_id)->toBe('700')
        ->and(DB::table('edna_flow_sends')->find($send->id)->response_event_id)->toBe($event->id)
        ->and(DB::table('edna_flow_send_attempts')->where('attempt_no', 2)->value('response_event_id'))->toBe($event->id);
});

test('an uncertain replacement POST is recorded once and never automatically resent', function () {
    $send = controlledResendFixture();
    controlledResendHistory([controlledResendMessage($send)]);
    controlledResendApply($send);
    $active = DB::table('edna_flow_sends')->find($send->id);
    $posts = 0;
    Http::fake(['app.edna.io/api/cascade/schedule' => function () use (&$posts) {
        $posts++;
        throw new ConnectionException('simulated timeout after provider may have received the request');
    }]);
    $job = new SendEdnaFlow($send->id, $active->transport_request_id);
    $job->handle();
    $job->handle();

    expect($posts)->toBe(1)
        ->and(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('unknown')
        ->and(DB::table('edna_flow_send_attempts')->where('attempt_no', 2)->value('state'))->toBe('unknown')
        ->and(DB::table('edna_flow_send_attempts')->where('attempt_no', 1)->value('state'))->toBe('rejected');
    expect(fn () => controlledResendApply($send, ['operation' => '8dac671c-c79f-405b-810f-984f809fae63']))
        ->toThrow(RuntimeException::class);
    expect($posts)->toBe(1);
});
