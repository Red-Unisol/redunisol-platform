<?php

use App\Jobs\ProcessEdnaIntake;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaFlow;
use App\Jobs\SendEdnaFlow;
use App\Jobs\SendEdnaLanding;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 10, 27)->setTime(14, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('i', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'webhook_key' => 'incoming-test', 'auth_header' => 'Authorization',
        'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/incoming',
        'router_enabled' => true, 'router_start_at' => now()->subDay()->toIso8601String(), 'router_recipients' => [],
        'api_key' => 'outgoing-test', 'cascade_id' => '2557', 'results_enabled' => true,
        'intake_enabled' => true, 'intake_crm_enabled' => true, 'intake_flow_id' => '999000111222333',
        'intake_start_at' => now()->subHour()->toIso8601String(), 'intake_recipients' => [],
        'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/test']);
    Http::preventStrayRequests();
    Http::fake(['kestra.example.test/incoming' => fn ($r) => Http::response([
        'ok' => true, 'event_key' => $r['subjectId'].':'.$r['id'],
        'kind' => $r['messageContent']['type'] === 'FLOW' ? 'flow_response' : 'router_entry',
        'flow_id_verified' => $r['routerContext']['verified'] ?? false,
    ])]);
    Queue::fake();
});

function intakeInbound(array $changes = []): object
{
    $payload = array_replace_recursive(['id' => (string) (1000 + DB::table('edna_incoming_events')->count()),
        'subjectId' => 2423, 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola, vengo del sitio web de Red Unisol']], $changes);
    test()->postJson('/api/webhooks/edna/incoming', $payload, ['Authorization' => 'Token incoming-test'])->assertOk();

    return DB::table('edna_incoming_events')->latest('id')->first();
}

function intakeReserve(): ?object
{
    $journey = (new AttributionJourney)->create(['version' => 1,
        'first' => ['utm_source' => 'ig', 'utm_campaign' => 'original'],
        'last' => ['utm_source' => 'ig', 'utm_campaign' => 'original']]);
    $event = intakeInbound(['messageContent' => ['text' => 'Hola, vengo del sitio web de Red Unisol (ref: '.$journey->id.')']]);
    (new ReceiveEdnaInKestra($event->id))->handle();

    return DB::table('edna_flow_sends')->latest('id')->first();
}

function intakeReply(array $changes = []): object
{
    $send = intakeReserve();
    DB::table('edna_flow_sends')->where('id', $send->id)->update([
        'state' => 'confirmed', 'outgoing_message_id' => '900', 'send_started_at' => now(),
    ]);
    $event = intakeInbound(array_replace_recursive(['replyOutMessageId' => '900',
        'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => 'catamarca',
            'situacion_catamarca' => 'policia', 'banco_catamarca' => 'nacion', 'cuil' => '20301234563'])]], $changes));
    (new ReceiveEdnaInKestra($event->id))->handle();

    return DB::table('edna_intake_requests')->latest('id')->first();
}

test('only a bound website reference reserves the new Flow', function () {
    $send = intakeReserve();
    expect($send->flow_id)->toBe('999000111222333')->and($send->journey_id)->not->toBeNull();
    expect((new EdnaFlowRouter)->scope('2423', '5493510000000'))->not->toBe($send->scope);
    Queue::assertPushed(SendEdnaFlow::class);
    $event = intakeInbound();
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(1);
    expect(DB::table('edna_incoming_events')->find($event->id)->router_action)->toBe('intake_requires_website_context');
});

test('invalid expired and differently bound references do not enter intake', function (string $kind) {
    $journey = (new AttributionJourney)->create(['version' => 1, 'first' => [], 'last' => []]);
    if ($kind === 'expired') {
        DB::table('attribution_journeys')->where('id', $journey->id)->update(['expires_at' => now()->subMinute()]);
    } elseif ($kind === 'other_phone') {
        (new AttributionJourney)->bind('(ref: '.$journey->id.')', '5493519999999', '2423');
    }
    $ref = $kind === 'invalid' ? 'unknown0000' : $journey->id;
    $event = intakeInbound(['messageContent' => ['text' => 'Hola, vengo del sitio web de Red Unisol (ref: '.$ref.')']]);
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(0);
})->with(['invalid', 'expired', 'other_phone']);

test('intake cutover excludes missing Flow ID old entries and pilot exclusions', function (string $gate) {
    match ($gate) {
        'id' => config()->set('edna.intake_flow_id', ''),
        'legacy' => config()->set('edna.intake_flow_id', EdnaFlowRouter::FLOW_ID),
        'start' => config()->set('edna.intake_start_at', now()->addMinute()->toIso8601String()),
        'recipient' => config()->set('edna.intake_recipients', ['5493519999999']),
    };
    expect(intakeReserve())->toBeNull();
    Queue::assertNotPushed(SendEdnaFlow::class);
})->with(['id', 'legacy', 'start', 'recipient']);

test('sending and history confirmation use the new Flow and CUIL copy', function () {
    $send = intakeReserve();
    Http::fake([
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE', 'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/cascade/schedule' => fn ($r) => Http::response(['requestId' => $r['requestId']]),
        'app.edna.io/api/messages/history' => Http::response(['content' => [[
            'messageId' => 900, 'comment' => $send->request_id, 'direction' => 'OUT', 'channelType' => 'WHATSAPP',
            'subjectId' => 2423, 'cascadeId' => 2557, 'address' => '5493510000000', 'deliveryStatus' => 'READ',
            'content' => ['type' => 'FLOW', 'flowId' => 999000111222333],
        ]], 'hasNext' => false]),
    ]);
    (new SendEdnaFlow($send->id))->handle();
    (new ReconcileEdnaFlow($send->id))->handle();
    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('confirmed');
    Http::assertSent(fn ($r) => str_ends_with($r->url(), 'cascade/schedule')
        && $r['content']['whatsappContent']['flowId'] === 999000111222333
        && str_contains($r['content']['whatsappContent']['text'], 'CUIL'));
});

test('cutover can cancel a pending new Flow before any WhatsApp send', function () {
    $send = intakeReserve();
    config()->set('edna.intake_enabled', false);
    (new SendEdnaFlow($send->id))->handle();
    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('cancelled');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
});

test('one correlated reply stores encrypted identity and queues intake without landing or rescue', function () {
    $request = intakeReply();
    expect($request->state)->toBe('pending')->and($request->answer)->not->toContain('20301234563');
    expect(DB::table('edna_router_results')->count())->toBe(0);
    expect(DB::table('edna_assistance_cases')->count())->toBe(0);
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    Queue::assertNotPushed(SendEdnaLanding::class);
    (new ReceiveEdnaInKestra($request->response_event_id))->handle();
    expect(DB::table('edna_intake_requests')->count())->toBe(1);
});

test('a second submission of the same confirmed Flow is acknowledged without another CRM job', function () {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    $event = intakeInbound(['replyOutMessageId' => '900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['cuil' => '20301234563'])]]);
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect(DB::table('edna_intake_requests')->count())->toBe(1);
    expect(DB::table('edna_incoming_events')->find($event->id)->router_action)->toBe('intake_duplicate_response');
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
});

test('a queue failure rolls the reply back so it can be accepted once after recovery', function () {
    $send = intakeReserve();
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'confirmed', 'outgoing_message_id' => '900', 'send_started_at' => now()]);
    $event = intakeInbound(['replyOutMessageId' => '900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['cuil' => '20301234563'])]]);
    Queue::shouldReceive('connection')->with('edna')->once()->andThrow(new RuntimeException('private'));
    expect(fn () => (new ReceiveEdnaInKestra($event->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_intake_requests')->count())->toBe(0);
    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('confirmed');
    expect(DB::table('edna_incoming_events')->find($event->id)->status)->toBe('pending');
});

test('status hides identity data and retention preserves unresolved requests', function () {
    $request = intakeReply();
    $this->artisan('edna:intake status')->assertSuccessful();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'unknown', 'updated_at' => now()->subDays(31)]);
    $this->artisan('edna:intake prune --apply')->assertSuccessful();
    expect(DB::table('edna_intake_requests')->find($request->id)->answer)->not->toBeNull();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'synced']);
    $this->artisan('edna:intake prune --apply')->assertSuccessful();
    expect(DB::table('edna_intake_requests')->find($request->id)->answer)->toBeNull();
});

test('an uncorrelated phone or message cannot submit an intake', function (array $changes) {
    expect(fn () => intakeReply($changes))->toThrow(RuntimeException::class);
    expect(DB::table('edna_intake_requests')->count())->toBe(0);
})->with([[['subscriber' => ['identifier' => '5493519999999']]], [['replyOutMessageId' => '901']]]);

test('processing forwards the bound attribution and acknowledges a CRM result once', function () {
    $request = intakeReply();
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'reason' => 'ready', 'lead_id' => '77', 'contact_id' => '88',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('synced');
    Http::assertSent(fn ($r) => str_contains($r->url(), '/bitrix24_whatsapp_intake/')
        && $r['attribution']['last']['utm_campaign'] === 'original'
        && $r['attribution']['wa']['WA_ENTRY'] === 'website' && $r['contract'] === 'website-intake-v1'
        && $r['answer']['cuil'] === '20301234563' && $r['dry_run'] === false);
    Http::assertSentCount(1); // Http::fake resets the recording before the CRM call.
});

test('a CRM timeout never replays a potentially completed write', function () {
    $request = intakeReply();
    $attempts = 0;
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => function () use (&$attempts) {
        $attempts++;
        throw new ConnectionException('private');
    }]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('unknown');
    expect($attempts)->toBe(1);
});

test('invalid identity is retained for review without automatic retries', function () {
    $request = intakeReply();
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => Http::response(['ok' => false, 'action' => 'invalid'])]);
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('review');
});

test('pending legacy Router responses still finish their previous route after cutover', function () {
    config()->set('edna.intake_enabled', false);
    $send = intakeReserve();
    expect($send->flow_id)->toBe(EdnaFlowRouter::FLOW_ID);
    config()->set('edna.intake_enabled', true);
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'confirmed', 'outgoing_message_id' => '900', 'send_started_at' => now()]);
    $event = intakeInbound(['replyOutMessageId' => '900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => 'catamarca', 'situacion_catamarca' => 'policia'])]]);
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect(DB::table('edna_router_results')->count())->toBe(1);
    expect(DB::table('edna_intake_requests')->count())->toBe(0);
});
