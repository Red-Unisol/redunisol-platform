<?php

use App\Jobs\ProcessEdnaIntake;
use App\Services\EdnaBenefitsRouting;
use App\Services\EdnaBitrix;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaNativeIntake;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicLoan;
use App\Services\WebFormChatLinker;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 18)->setTime(17, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('q', 32)));
    config()->set('cache.default', 'array');
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'subject_id' => '2423',
        'api_key' => 'fixture', 'cascade_id' => '2557', 'router_start_at' => now()->subDay()->toIso8601String(),
        'router_recipients' => [], 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '950118281197789', 'intake_start_at' => now()->subDay()->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'benefits-business-test', 'intake_pilot_limit' => 'unlimited',
        'intake_processing_url' => 'https://business.example.test/bitrix24_whatsapp_intake/key']);
    DB::table('edna_intake_cutovers')->insert(['name' => 'native-v3-v1', 'entry_id_after' => 0, 'starts_at' => now()->subDay()]);
    Queue::fake();
    Http::preventStrayRequests();
});

function benefitsBusinessEvent(): object
{
    $message = (string) (890000 + DB::table('edna_incoming_events')->count());
    $payload = ['id' => $message, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta previa']];
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_incoming_events')->find($id);
}

function benefitsBusinessProof(object $event): array
{
    return ['version' => 2, 'source' => 'bitrix_openline_session', 'verified' => true, 'evidence' => 'external_message_id',
        'entry_event_id' => (int) $event->id, 'entry_message_id' => $event->message_id, 'chat_id' => '93701',
        'session_id' => '317975', 'activity_id' => '713341', 'message_id' => '7083001', 'native_lead_id' => null, 'contact_id' => '301'];
}

class BenefitsBusinessCrm extends EdnaBitrix
{
    public array $calls = [];

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = $method;
        if ($method === 'imopenlines.dialog.get') {
            return ['owner' => 0, 'entity_data_1' => 'Y|DEAL|1248323|N|N|317975|0|0|0|0'];
        }
        throw new RuntimeException('The Benefits barrier must precede credit CRM operations.');
    }
}

function benefitsBusinessWebRoute(string $transfer = 'pending'): array
{
    $entry = benefitsBusinessEvent();
    $proof = benefitsBusinessProof($entry);
    if ($transfer === 'unknown') {
        $proof['transfer_intent'] = ['seller_id' => '29', 'session_id' => '317975', 'owner_before' => '0'];
    }
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => $entry->id, 'submission_id' => (string) Str::uuid(),
        'state' => $transfer === 'unknown' ? 'unknown' : 'pending', 'transfer_state' => $transfer,
        'proof' => json_encode($proof), 'available_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

    return [$entry, $proof];
}

test('a web route with a native Benefits case yields before any credit eligibility or CRM binding', function (string $state) {
    [$entry, $proof] = benefitsBusinessWebRoute();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->withArgs(fn ($event, $p) => $event->id === $entry->id && $p === $proof)
        ->andReturn(['state' => $state, 'reason' => $state === 'preserved' ? 'benefits_routing' : 'benefits_native_evidence_pending']);
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $crm = new BenefitsBusinessCrm;

    $result = (new WebFormChatLinker($crm))->process((int) $entry->id);

    expect($result['state'])->toBe($state)->and($crm->calls)->toBe([])
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $entry->id)->first()->transfer_state)
        ->toBe($state === 'preserved' ? 'preserved' : 'pending');
    Http::assertNothingSent();
})->with(['preserved', 'waiting', 'review']);

test('an uncertain original web transfer is reconciled before inspecting any new Benefits route', function () {
    [$entry] = benefitsBusinessWebRoute('unknown');
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldNotReceive('eligibleEntry');
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $crm = new BenefitsBusinessCrm;

    $result = (new WebFormChatLinker($crm))->process((int) $entry->id);

    expect($result)->toMatchArray(['state' => 'unknown', 'reason' => 'transfer_result_uncertain'])
        ->and($crm->calls)->toBe(['imopenlines.dialog.get']);
    Http::assertNothingSent();
});

test('a web entry outside the Benefits cut retains its original continuation validation', function () {
    [$entry] = benefitsBusinessWebRoute();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnFalse();
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $crm = new BenefitsBusinessCrm;

    expect((new WebFormChatLinker($crm))->process((int) $entry->id))
        ->toMatchArray(['state' => 'review', 'reason' => 'web_continuation_not_verified'])
        ->and($crm->calls)->toBe([]);
});

function benefitsBusinessCompletedRequest(): array
{
    $entry = benefitsBusinessEvent();
    $sendId = (new EdnaFlowRouter)->startPaidEntry($entry, json_decode(Crypt::decryptString($entry->payload), true),
        ['version' => 1, 'route' => 'paid_direct_v3', 'evidence' => ['kind' => 'provider_ad_referral', 'source_id' => 'fixture-ad']]);
    DB::table('edna_flow_sends')->where('id', $sendId)->update(['state' => 'completed', 'response_event_id' => 99999]);
    $requestId = DB::table('edna_intake_requests')->insertGetId(['flow_send_id' => $sendId, 'response_event_id' => 99999,
        'state' => 'pending', 'received_at' => now(), 'answer' => Crypt::encryptString(json_encode([
            'provincia' => 'cordoba', 'situacion_cordoba' => 'empleado_publico', 'banco_cordoba' => 'bancor', 'cuil' => '20123456786'])),
        'created_at' => now(), 'updated_at' => now()]);

    return [DB::table('edna_intake_requests')->find($requestId), DB::table('edna_flow_sends')->find($sendId), benefitsBusinessProof($entry), $entry];
}

test('a completed v3 checks the original TEXT proof and yields to Benefits without a business POST', function () {
    [$request, $send, $proof, $entry] = benefitsBusinessCompletedRequest();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->withArgs(fn ($event, $p) => $event->id === $entry->id && $p === $proof)
        ->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldNotReceive('inspectWelcome');
    app()->instance(EdnaOrganicAttention::class, $attention);

    (new EdnaNativeIntake)->process($request, $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id))->toMatchObject(['state' => 'review', 'reason' => 'benefits_routing']);
    Http::assertNothingSent();
    Queue::assertNotPushed(ProcessEdnaIntake::class);
});

test('two simultaneous waiting native preflights schedule only one pending retry and then resume into Benefits', function () {
    [$request, $send, $proof] = benefitsBusinessCompletedRequest();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->times(3)->andReturnTrue();
    $driver->shouldReceive('check')->times(3)->andReturn(
        ['state' => 'waiting', 'reason' => 'benefits_native_read_pending'],
        ['state' => 'waiting', 'reason' => 'benefits_native_read_pending'],
        ['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $service = new EdnaNativeIntake;
    $service->process($request, $send, $proof);
    $service->process($request, $send, $proof);
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('pending');
    $this->travel(65)->seconds();
    $service->process(DB::table('edna_intake_requests')->find($request->id), $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id))->toMatchObject(['state' => 'review', 'reason' => 'benefits_routing']);
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    Http::assertNothingSent();
});

test('a pending native Benefits preflight expires after eight hours without historical rescue', function () {
    [$request, $send, $proof, $entry] = benefitsBusinessCompletedRequest();
    $payload = json_decode(Crypt::decryptString($entry->payload), true);
    $payload['receivedAt'] = now()->subHours(8)->toIso8601String();
    DB::table('edna_incoming_events')->where('id', $entry->id)->update(['payload' => Crypt::encryptString(json_encode($payload))]);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->andReturn(['state' => 'waiting', 'reason' => 'benefits_native_read_pending']);
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new EdnaNativeIntake)->process($request, $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id))->toMatchObject(['state' => 'review', 'reason' => 'benefits_preflight_expired']);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
    Http::assertNothingSent();
});

test('a stale native worker cannot change or requeue processing or uncertain requests', function (string $state) {
    [$request, $send, $proof] = benefitsBusinessCompletedRequest();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => $state]);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldNotReceive('eligibleEntry');
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new EdnaNativeIntake)->process($request, $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe($state);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
    Http::assertNothingSent();
})->with(['processing', 'unknown']);

test('a native source outside the new Benefits cut keeps its prior business contract', function () {
    [$request, $send, $proof] = benefitsBusinessCompletedRequest();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnFalse();
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturn(['status' => 'ready']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    Http::fake(['business.example.test/*' => Http::response(['ok' => true, 'contract' => EdnaOrganicLoan::CONTRACT,
        'case_id' => $send->request_id, 'action' => 'queued', 'reason' => 'ready', 'write_attempted' => false,
        'lead_id' => '501', 'contact_id' => '301'])]);

    (new EdnaNativeIntake)->process($request, $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('synced');
    Http::assertSentCount(1);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
});

test('human acceptance during the last native Benefits check stops the business POST', function () {
    [$request, $send, $proof] = benefitsBusinessCompletedRequest();
    $accepted = false;
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $checks = 0;
    $driver->shouldReceive('check')->twice()->andReturnUsing(function () use (&$accepted, &$checks) {
        if (++$checks === 2) {
            $accepted = true;
        }

        return null;
    });
    app()->instance(EdnaBenefitsRouting::class, $driver);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturnUsing(function () use (&$accepted) {
        expect($accepted)->toBeTrue();

        return ['status' => 'preserved', 'reason' => 'operator_attention_preserved', 'owner_id' => '74827'];
    });
    app()->instance(EdnaOrganicAttention::class, $attention);

    (new EdnaNativeIntake)->process($request, $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id))->toMatchObject([
        'state' => 'review', 'reason' => 'operator_attention_preserved']);
    Http::assertNothingSent();
});

test('an expired pending retry cannot resume credit when Benefits evidence later becomes available', function () {
    [$request, $send, $proof, $entry] = benefitsBusinessCompletedRequest();
    $payload = json_decode(Crypt::decryptString($entry->payload), true);
    $payload['receivedAt'] = now()->subHours(8)->toIso8601String();
    DB::table('edna_incoming_events')->where('id', $entry->id)->update(['payload' => Crypt::encryptString(json_encode($payload))]);
    DB::table('edna_intake_requests')->where('id', $request->id)->update([
        'reason' => 'benefits_wait:benefits_native_read_pending', 'updated_at' => now()->subMinute()]);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldNotReceive('eligibleEntry');
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new EdnaNativeIntake)->process($request, $send, $proof);

    expect(DB::table('edna_intake_requests')->find($request->id))->toMatchObject([
        'state' => 'review', 'reason' => 'benefits_preflight_expired']);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
    Http::assertNothingSent();
});
