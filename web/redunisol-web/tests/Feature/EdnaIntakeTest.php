<?php

use App\Jobs\ProcessEdnaIntake;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaFlow;
use App\Jobs\SendEdnaFlow;
use App\Jobs\SendEdnaLanding;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaIntake;
use App\Services\EdnaIntakePilot;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\Process\Process;

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

function intakeReserve(string $phone = '5493510000000'): ?object
{
    $journey = (new AttributionJourney)->create(['version' => 1,
        'first' => ['utm_source' => 'ig', 'utm_campaign' => 'original'],
        'last' => ['utm_source' => 'ig', 'utm_campaign' => 'original']]);
    $event = intakeInbound(['subscriber' => ['identifier' => $phone],
        'messageContent' => ['text' => 'Hola, vengo del sitio web de Red Unisol (ref: '.$journey->id.')']]);
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
    expect(DB::table('edna_flow_sends')->count())->toBe(2);
    expect(DB::table('edna_flow_sends')->latest('id')->first()->flow_id)->toBe(EdnaFlowRouter::FLOW_ID);
    expect(DB::table('edna_intake_admissions')->count())->toBe(1);
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
    expect(DB::table('edna_flow_sends')->first()->flow_id)->toBe(EdnaFlowRouter::FLOW_ID);
    expect(DB::table('edna_intake_admissions')->count())->toBe(0);
})->with(['invalid', 'expired', 'other_phone']);

test('intake cutover excludes missing Flow ID old entries and pilot exclusions', function (string $gate) {
    match ($gate) {
        'id' => config()->set('edna.intake_flow_id', ''),
        'legacy' => config()->set('edna.intake_flow_id', EdnaFlowRouter::FLOW_ID),
        'start' => config()->set('edna.intake_start_at', now()->addMinute()->toIso8601String()),
        'recipient' => config()->set('edna.intake_recipients', ['5493519999999']),
    };
    expect(intakeReserve()->flow_id)->toBe(EdnaFlowRouter::FLOW_ID);
    expect(DB::table('edna_intake_admissions')->count())->toBe(0);
    expect(DB::table('edna_intake_pilots')->count())->toBe(0);
    Queue::assertPushed(SendEdnaFlow::class);
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

test('new Cordoba employment options reach the dedicated intake without a legacy landing or another slot', function (string $situation) {
    $request = intakeReply(['messageContent' => ['text' => json_encode(['provincia' => 'cordoba',
        'situacion_cordoba' => $situation, 'banco_cordoba' => 'bancor', 'cuil' => '20301234563'])]]);
    expect(DB::table('edna_incoming_events')->find($request->response_event_id)->outcome)->toBe('website_intake')
        ->and(DB::table('edna_router_results')->count())->toBe(0)
        ->and(DB::table('edna_assistance_cases')->count())->toBe(0);
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    Queue::assertNotPushed(SendEdnaLanding::class);
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'lead_id' => '77', 'contact_id' => '88',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['answer']['situacion_cordoba'] === $situation
        && $r['answer']['banco_cordoba'] === 'bancor' && $r['answer']['provincia'] === 'cordoba');
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('synced')
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 1); // Only the original reservation.
})->with(['daspu', 'empleado_publico_municipal', 'jubilado_municipal']);

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

test('commercial rejection is synchronized with its lead and never stays in review or consumes another slot', function (string $reason) {
    $request = intakeReply(['messageContent' => ['text' => json_encode(['provincia' => 'otra', 'banco_otra' => 'nacion', 'cuil' => '123'])]]);
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'rejected', 'reason' => $reason, 'lead_id' => '77', 'contact_id' => '',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    $saved = DB::table('edna_intake_requests')->find($request->id);
    expect($saved->state)->toBe('synced')->and($saved->reason)->toBe($reason)->and($saved->lead_id)->toBe('77')
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Http::assertSentCount(1);
    Queue::assertNotPushed(SendEdnaLanding::class);
    Queue::assertPushed(SendEdnaFlow::class, 1);
})->with(['province_not_eligible', 'employment_status_not_eligible']);

test('a rejection without a persisted lead is an uncertain result and is never retried', function () {
    $request = intakeReply();
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'rejected', 'reason' => 'province_not_eligible',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('unknown');
    Http::assertSentCount(1);
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

test('the first ten unique website entrants receive intake and the eleventh completes the legacy landing route', function () {
    for ($i = 1; $i <= 11; $i++) {
        $send = intakeReserve(sprintf('549351%07d', $i));
        expect($send->flow_id)->toBe($i <= 10 ? '999000111222333' : EdnaFlowRouter::FLOW_ID);
    }
    expect(DB::table('edna_intake_admissions')->count())->toBe(10);
    expect(DB::table('edna_intake_pilots')->value('admitted'))->toBe(10);
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'confirmed', 'outgoing_message_id' => '900', 'send_started_at' => now()]);
    $reply = intakeInbound(['subscriber' => ['identifier' => sprintf('549351%07d', 11)],
        'replyOutMessageId' => '900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => 'catamarca', 'situacion_catamarca' => 'policia'])]]);
    (new ReceiveEdnaInKestra($reply->id))->handle();
    expect(DB::table('edna_router_results')->count())->toBe(1);
    expect(DB::table('edna_intake_requests')->count())->toBe(0);
    Queue::assertPushed(SendEdnaLanding::class, 1);
    $this->artisan('edna:intake pilot')->expectsOutputToContain('"limit":10')->assertSuccessful();
});

test('quota exhaustion preserves in flight replies processing and returning participants', function () {
    $send = intakeReserve();
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'confirmed', 'outgoing_message_id' => '900', 'send_started_at' => now()]);
    for ($i = 1; $i <= 10; $i++) {
        intakeReserve(sprintf('549351%07d', $i));
    }
    expect(DB::table('edna_intake_admissions')->count())->toBe(10);
    $reply = intakeInbound(['replyOutMessageId' => '900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => 'catamarca',
            'situacion_catamarca' => 'policia', 'banco_catamarca' => 'nacion', 'cuil' => '20301234563'])]]);
    (new ReceiveEdnaInKestra($reply->id))->handle();
    $request = DB::table('edna_intake_requests')->first();
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'lead_id' => '77',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('synced');
    $before = DB::table('edna_flow_sends')->count();
    intakeReserve(); // A new website reference for the same phone hits the existing cooldown.
    expect(DB::table('edna_flow_sends')->count())->toBe($before);
    $this->travel(25)->hours();
    $return = intakeReserve();
    expect($return->flow_id)->toBe($send->flow_id)->and($return->intake_admission_id)->toBe($send->intake_admission_id);
    expect(DB::table('edna_intake_pilots')->value('admitted'))->toBe(10);
    expect(DB::table('edna_intake_admissions')->count())->toBe(10);
});

test('queue rollback restores the admission counter together with the Flow reservation', function () {
    $journey = (new AttributionJourney)->create(['version' => 1, 'first' => [], 'last' => []]);
    $event = intakeInbound(['messageContent' => ['text' => 'Hola, vengo del sitio web de Red Unisol (ref: '.$journey->id.')']]);
    Queue::shouldReceive('connection')->with('edna')->once()->andThrow(new RuntimeException('private'));
    expect(fn () => (new ReceiveEdnaInKestra($event->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_intake_admissions')->count())->toBe(0);
    expect(DB::table('edna_intake_pilots')->count())->toBe(0);
    expect(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('cancelled unknown and abandoned sends never release a participant slot', function () {
    for ($i = 1; $i <= 10; $i++) {
        $send = intakeReserve(sprintf('549351%07d', $i));
        DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => $i % 2 ? 'cancelled' : 'unknown']);
    }
    expect(intakeReserve(sprintf('549351%07d', 11))->flow_id)->toBe(EdnaFlowRouter::FLOW_ID);
    expect(DB::table('edna_intake_pilots')->value('admitted'))->toBe(10);
});

test('new admission restrictions and a new batch do not invalidate already reserved participants', function () {
    $send = intakeReserve();
    config()->set('edna.intake_recipients', ['5493519999999']);
    config()->set('edna.intake_start_at', now()->addDay()->toIso8601String());
    expect((new EdnaIntake)->canSend($send))->toBeTrue();
    $this->travel(25)->hours();
    expect(intakeReserve()->intake_admission_id)->toBe($send->intake_admission_id);
    config()->set('edna.intake_recipients', []);
    config()->set('edna.intake_pilot_id', 'website-intake-next-10');
    $next = intakeReserve();
    expect($next->intake_admission_id)->not->toBe($send->intake_admission_id);
    expect(DB::table('edna_intake_pilots')->count())->toBe(2);
    expect((new EdnaIntake)->canSend($send))->toBeTrue();
});

test('a participant admission cannot be reused for another phone', function () {
    $first = intakeReserve();
    $other = intakeReserve('5493519999999');
    DB::table('edna_flow_sends')->where('id', $other->id)->update(['intake_admission_id' => $first->intake_admission_id]);
    expect((new EdnaIntake)->canSend(DB::table('edna_flow_sends')->find($other->id)))->toBeFalse();
});

test('parallel database workers cannot exceed ten distinct admissions or double count one phone', function () {
    $file = tempnam(sys_get_temp_dir(), 'edna-quota-');
    $gate = $file.'.go';
    $processes = [];
    $default = DB::getDefaultConnection();
    config()->set('database.connections.pilot_race', ['driver' => 'sqlite', 'database' => $file,
        'foreign_key_constraints' => true, 'busy_timeout' => 10000]);
    try {
        DB::setDefaultConnection('pilot_race');
        DB::statement('PRAGMA journal_mode=WAL');
        DB::statement('PRAGMA busy_timeout=10000');
        Schema::create('edna_flow_sends', fn ($table) => $table->id());
        $migration = require database_path('migrations/2026_10_27_150000_create_edna_intake_pilot_admissions.php');
        $migration->up();
        $first = (new EdnaIntakePilot)->reserve('2423', '5493510000000', '999000111222333', true);
        DB::setDefaultConnection($default);
        $phones = [...array_map(fn ($i) => sprintf('549351%07d', $i), range(1, 12)),
            '5493510000000', '5493510000000', '5493510000000'];
        $extensions = PHP_OS_FAMILY === 'Windows' ? ['-d', 'extension=php_pdo_sqlite.dll', '-d', 'extension=php_intl.dll'] : [];
        foreach ($phones as $phone) {
            $process = new Process([PHP_BINARY, ...$extensions, base_path('tests/Fixtures/edna-pilot-quota-worker.php')], base_path(),
                ['APP_ENV' => 'testing', 'APP_URL' => 'https://example.test'],
                json_encode(['database' => $file, 'phone' => $phone, 'gate' => $gate]), 90);
            $process->start();
            $processes[] = $process;
        }
        $deadline = microtime(true) + 60;
        do {
            $ready = true;
            foreach ($processes as $process) {
                if (! str_contains($process->getOutput(), 'ready')) {
                    if (! $process->isRunning()) {
                        throw new RuntimeException($process->getErrorOutput().$process->getOutput());
                    }
                    $ready = false;
                }
            }
            if (! $ready) {
                usleep(10000);
            }
        } while (! $ready && microtime(true) < $deadline);
        expect($ready)->toBeTrue('Workers did not reach the concurrency barrier.');
        file_put_contents($gate, 'go');
        foreach ($processes as $index => $process) {
            $process->wait();
            expect($process->isSuccessful())->toBeTrue($process->getErrorOutput().$process->getOutput());
            $lines = explode("\n", trim($process->getOutput()));
            $result = json_decode(end($lines), true, 8, JSON_THROW_ON_ERROR);
            if ($phones[$index] === '5493510000000') {
                expect($result['admission_id'])->toBe($first->id);
            }
        }
        expect(DB::connection('pilot_race')->table('edna_intake_pilots')->value('admitted'))->toBe(10);
        expect(DB::connection('pilot_race')->table('edna_intake_admissions')->count())->toBe(10);
        expect(DB::connection('pilot_race')->table('edna_intake_admissions')->orderBy('slot')->pluck('slot')->all())->toBe(range(1, 10));
        DB::setDefaultConnection('pilot_race');
        $migration->down();
        expect(Schema::hasTable('edna_intake_pilots'))->toBeFalse();
        expect(Schema::hasColumn('edna_flow_sends', 'intake_admission_id'))->toBeFalse();
    } finally {
        DB::setDefaultConnection($default);
        foreach ($processes as $process) {
            if ($process->isRunning()) {
                $process->stop();
            }
        }
        DB::purge('pilot_race');
        foreach ([$file, $file.'-wal', $file.'-shm', $gate] as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
    }
});

test('audited review rescue keeps the original answer UUID and quota and records a manual lead', function (string $reason) {
    $request = intakeReply(['messageContent' => ['text' => json_encode(['provincia' => 'catamarca',
        'situacion_catamarca' => 'policia', 'banco_catamarca' => 'nacion', 'cuil' => '123'])]]);
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'review', 'reason' => $reason]);
    $args = ['action' => 'rescue', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--confirmed-no-writes' => true];
    Queue::fake();
    $this->artisan('edna:intake', ['action' => 'rescue', 'id' => $request->id])->assertSuccessful();
    Queue::assertNothingPushed();
    $this->artisan('edna:intake', $args)->assertSuccessful();
    $this->artisan('edna:intake', $args)->assertFailed();
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'manual_review',
        'reason' => 'pending_cuil', 'lead_id' => '77', 'contact_id' => '',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['case_id'] === $send->request_id && $r['answer']['cuil'] === '123');
    $saved = DB::table('edna_intake_requests')->find($request->id);
    expect($saved->state)->toBe('review')->and($saved->lead_id)->toBe('77')
        ->and($saved->reason)->toBe('pending_cuil')->and($saved->answer)->toBe($request->answer)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_requests')->count())->toBe(1);
    $this->artisan('edna:intake', $args)->assertFailed(); // A visible manual lead is never replayed.
})->with(['invalid_intake_response', 'ambiguous_contact']);

test('review rescue requires the audit and refuses any recorded CRM identity or uncertain processing', function (string $condition) {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'review', 'reason' => 'ambiguous_contact']);
    $args = ['action' => 'rescue', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--confirmed-no-writes' => true];
    match ($condition) {
        'lead', 'contact' => DB::table('edna_intake_requests')->where('id', $request->id)->update([$condition.'_id' => '77']),
        'unknown', 'processing', 'pending' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => $condition]),
        'reason' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['reason' => 'pending_cuil']),
        'audit' => $args['--confirmed-no-writes'] = false,
        'case' => $args['--expected-case'] = '00000000-0000-4000-8000-000000000001',
        'answer' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['answer' => null]),
        'response' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['response_event_id' => 99999]),
        'expired' => DB::table('attribution_journeys')->where('id', $send->journey_id)->update(['expires_at' => now()->subDay()]),
        'disabled' => config()->set('edna.intake_crm_enabled', false),
    };
    Queue::fake();
    $this->artisan('edna:intake', $args)->assertFailed();
    Queue::assertNothingPushed();
})->with(['lead', 'contact', 'unknown', 'processing', 'pending', 'reason', 'audit', 'case', 'answer', 'response', 'expired', 'disabled']);

test('review rescue rolls back when enqueueing fails', function () {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'review', 'reason' => 'invalid_intake_response']);
    Queue::shouldReceive('connection')->with('edna')->andReturnSelf();
    Queue::shouldReceive('push')->once()->andThrow(new RuntimeException('private'));
    $this->artisan('edna:intake', ['action' => 'rescue', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--confirmed-no-writes' => true])->assertFailed();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('review')
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
});

test('prewrite recovery previews and requires explicit case and audit confirmation', function () {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update([
        'state' => 'unknown', 'reason' => 'crm_acknowledgement_uncertain',
    ]);
    Queue::fake();
    $this->artisan('edna:intake', ['action' => 'recover', 'id' => $request->id])->assertSuccessful();
    foreach ([[], ['--expected-case' => $send->request_id], ['--confirmed-no-writes' => true],
        ['--expected-case' => '00000000-0000-4000-8000-000000000001', '--confirmed-no-writes' => true]] as $flags) {
        $this->artisan('edna:intake', ['action' => 'recover', 'id' => $request->id, '--apply' => true] + $flags)->assertFailed();
    }
    Queue::assertNothingPushed();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('unknown');
});

test('prewrite recovery resumes the saved case once without another Flow or quota slot', function () {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update([
        'state' => 'unknown', 'reason' => 'crm_acknowledgement_uncertain',
    ]);
    $args = ['action' => 'recover', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--confirmed-no-writes' => true];
    Queue::fake();
    $this->artisan('edna:intake', $args)->assertSuccessful();
    $this->artisan('edna:intake', $args)->assertFailed(); // Already queued; never enqueue twice.
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    Queue::assertNotPushed(SendEdnaFlow::class);
    expect(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->find($send->id)->request_id)->toBe($send->request_id)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_intake_requests')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->count())->toBe(2);
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'already_processed', 'lead_id' => '77', 'contact_id' => '88',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    $this->artisan('edna:intake', $args)->assertSuccessful(); // Synced is an idempotent no-op.
    (new ProcessEdnaIntake($request->id))->handle();
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['case_id'] === $send->request_id && $r['answer']['cuil'] === '20301234563');
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('synced')
        ->and(DB::table('edna_intake_requests')->find($request->id)->lead_id)->toBe('77');
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
});

test('prewrite recovery rolls back if queue insertion fails', function () {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update([
        'state' => 'unknown', 'reason' => 'crm_acknowledgement_uncertain',
    ]);
    Queue::shouldReceive('connection')->with('edna')->andReturnSelf();
    Queue::shouldReceive('push')->once()->andThrow(new RuntimeException('private'));
    $this->artisan('edna:intake', ['action' => 'recover', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--confirmed-no-writes' => true])->assertFailed();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('unknown')
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
});

test('prewrite recovery refuses in-flight reviewed expired or mismatched answers', function (string $condition) {
    $request = intakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_requests')->where('id', $request->id)->update([
        'state' => 'unknown', 'reason' => 'crm_acknowledgement_uncertain',
    ]);
    match ($condition) {
        'processing', 'review', 'pending' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => $condition]),
        'missing_answer' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['answer' => null]),
        'different_response' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['response_event_id' => 99999]),
        'expired_journey' => DB::table('attribution_journeys')->where('id', $send->journey_id)->update(['expires_at' => now()->subDay()]),
        'disabled' => config()->set('edna.intake_crm_enabled', false),
    };
    Queue::fake();
    $this->artisan('edna:intake', ['action' => 'recover', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--confirmed-no-writes' => true])->assertFailed();
    Queue::assertNothingPushed();
    expect(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
})->with(['processing', 'review', 'pending', 'missing_answer', 'different_response', 'expired_journey', 'disabled']);
