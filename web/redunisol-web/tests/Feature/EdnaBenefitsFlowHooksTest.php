<?php

use App\Jobs\ReconcileEdnaFlow;
use App\Jobs\SendEdnaFlow;
use App\Services\EdnaBenefitsRouting;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaIntakeBinding;
use App\Services\EdnaMessageBinding;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaPaidFlowGuard;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 18)->setTime(15, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('b', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'subject_id' => '2423',
        'api_key' => 'fixture', 'cascade_id' => '2557', 'router_start_at' => now()->subDay()->toIso8601String(),
        'router_recipients' => [], 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '950118281197789', 'intake_start_at' => now()->subDay()->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'benefits-hook-test', 'intake_pilot_limit' => 'unlimited']);
    DB::table('edna_intake_cutovers')->insert(['name' => 'native-v3-v1', 'entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    Queue::fake();
    Http::preventStrayRequests();
});

function benefitsHookEvent(): object
{
    $message = (string) (880000 + DB::table('edna_incoming_events')->count());
    $payload = ['id' => $message, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta']];
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_incoming_events')->find($id);
}

function benefitsHookProof(object $event): array
{
    return ['version' => 1, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'verified' => true, 'entry_event_id' => (int) $event->id, 'entry_message_id' => $event->message_id,
        'chat_id' => '93701', 'session_id' => '317975', 'activity_id' => '713341',
        'message_id' => '7083001', 'native_lead_id' => null];
}

function benefitsHookLegacy(?object $event = null, string $state = 'pending'): object
{
    $event ??= benefitsHookEvent();
    $id = DB::table('edna_flow_sends')->insertGetId(['request_id' => (string) Str::uuid(),
        'entry_event_id' => $event->id, 'scope' => hash('sha256', (string) $event->id), 'subject_id' => '2423',
        'cascade_id' => '2557', 'flow_id' => EdnaFlowRouter::FLOW_ID,
        'recipient' => Crypt::encryptString('5493510000000'), 'state' => $state,
        'entry_received_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_flow_sends')->find($id);
}

function benefitsHookPaid(): array
{
    $entry = benefitsHookEvent();
    $payload = json_decode(Crypt::decryptString($entry->payload), true);
    $id = (new EdnaFlowRouter)->startPaidEntry($entry, $payload, ['version' => 1, 'route' => 'paid_direct_v3',
        'evidence' => ['kind' => 'provider_ad_referral', 'source_id' => 'fixture-ad']]);

    return [DB::table('edna_flow_sends')->find($id), $entry];
}

function benefitsHookVerified(object $send, object $entry): array
{
    $proof = benefitsHookProof($entry) + ['lead_id' => '101'];
    DB::table('edna_intake_bindings')->insert(['flow_send_id' => $send->id, 'case_id' => $send->request_id,
        'entry_event_id' => $entry->id, 'state' => 'verified', 'lead_id' => '101', 'proof' => json_encode($proof),
        'verified_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

    return $proof;
}

function benefitsHookHttp(): void
{
    Http::fake(['app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
        'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/cascade/schedule' => fn ($request) => Http::response(['requestId' => $request['requestId']])]);
}

function benefitsHookAttention(array ...$results): void
{
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->andReturn(...($results ?: [[
        'status' => 'ready', 'owner_id' => '74827', 'session_id' => '317975']]));
    app()->instance(EdnaOrganicAttention::class, $attention);
}

test('a deal-only benefits proof routes before the native credit identity requirement', function () {
    [$send, $entry] = benefitsHookPaid();
    $proof = benefitsHookProof($entry); // No LEAD and no CONTACT credit identity.
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->once()->andReturn($proof);
    app()->instance(EdnaMessageBinding::class, $binding);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldNotReceive('snapshot');
    app()->instance(EdnaOrganicAttention::class, $attention);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->withArgs(fn ($event, $p) => $event->id === $entry->id && $p === $proof)
        ->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $driver);

    expect((new EdnaIntakeBinding)->resolve($send))->toBeNull()
        ->and(DB::table('edna_flow_sends')->find($send->id))->toMatchObject(['state' => 'cancelled', 'reason' => 'benefits_case_routing'])
        ->and(DB::table('edna_intake_bindings')->first())->toMatchObject(['state' => 'review', 'lead_id' => null]);
    Http::assertNothingSent();
});

test('transient benefits evidence retains a pending binding and does not invent a credit identity', function () {
    [$send, $entry] = benefitsHookPaid();
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->once()->andReturn(benefitsHookProof($entry));
    app()->instance(EdnaMessageBinding::class, $binding);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldNotReceive('snapshot');
    app()->instance(EdnaOrganicAttention::class, $attention);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->andReturn(['state' => 'waiting', 'reason' => 'benefits_native_read_pending']);
    app()->instance(EdnaBenefitsRouting::class, $driver);

    expect((new EdnaIntakeBinding)->resolve($send))->toBeNull()
        ->and(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('pending')
        ->and(DB::table('edna_intake_bindings')->first())->toMatchObject([
            'state' => 'pending', 'reason' => 'benefits_native_read_pending', 'lead_id' => null]);
    Http::assertNothingSent();
});

test('the paid sender reuses its proof and catches benefits linked during the cascade read', function () {
    [$send, $entry] = benefitsHookPaid();
    $proof = benefitsHookVerified($send, $entry);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldNotReceive('resolveCurrent');
    app()->instance(EdnaMessageBinding::class, $binding);
    benefitsHookAttention();
    benefitsHookHttp();
    $baseline = DB::transactionLevel();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $checks = 0;
    $driver->shouldReceive('check')->twice()->andReturnUsing(function ($event, $p) use (&$checks, $baseline, $proof, $entry) {
        expect(DB::transactionLevel())->toBe($baseline)->and($event->id)->toBe($entry->id)->and($p)->toEqual($proof);

        return ++$checks === 1 ? null : ['state' => 'preserved', 'reason' => 'benefits_routing'];
    });
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id))->toMatchObject(['state' => 'cancelled', 'reason' => 'benefits_case_routing']);
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/cascade/get-all'));
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});

test('a new legacy pending source resolves native proof once before both benefits barriers', function () {
    $send = benefitsHookLegacy();
    $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
    $proof = benefitsHookProof($entry);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->once()->andReturn($proof);
    app()->instance(EdnaMessageBinding::class, $binding);
    benefitsHookAttention();
    benefitsHookHttp();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->twice()->andReturnNull();
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('accepted');
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});

test('waiting benefits classification leaves the Flow pending without any provider send', function () {
    $send = benefitsHookLegacy();
    $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->once()->andReturn(benefitsHookProof($entry));
    app()->instance(EdnaMessageBinding::class, $binding);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->andReturn(['state' => 'waiting', 'reason' => 'benefits_native_read_pending']);
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id))->toMatchObject(['state' => 'pending', 'reason' => 'benefits_native_read_pending']);
    Http::assertNothingSent();
});

test('native proof missing after the new cutoff defers rather than sending v3 blindly', function () {
    $send = benefitsHookLegacy();
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->once()->andReturnNull();
    app()->instance(EdnaMessageBinding::class, $binding);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id))->toMatchObject(['state' => 'pending', 'reason' => 'benefits_native_message_pending']);
    Http::assertNothingSent();
});

test('a human who takes the new legacy chat during cascade reads is preserved', function () {
    $send = benefitsHookLegacy();
    $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->once()->andReturn(benefitsHookProof($entry));
    app()->instance(EdnaMessageBinding::class, $binding);
    benefitsHookAttention(['status' => 'ready', 'owner_id' => '74827', 'session_id' => '317975'],
        ['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
    benefitsHookHttp();
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->once()->andReturnTrue();
    $driver->shouldReceive('check')->twice()->andReturnNull();
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id))->toMatchObject([
        'state' => 'cancelled', 'reason' => 'organic_human_attention_preserved']);
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});

test('uncertain or acknowledged sends only reconcile and never enter benefits preflight', function (string $state) {
    $send = benefitsHookLegacy(null, $state);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldNotReceive('eligibleEntry');
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe($state);
    Queue::assertPushed(ReconcileEdnaFlow::class, 1);
    Http::assertNothingSent();
})->with(['accepted', 'unknown', 'sending']);

test('a postcut organic choice can be checked without reclassifying its precut entry as new', function () {
    $entry = benefitsHookEvent();
    $send = benefitsHookLegacy($entry);
    $choice = benefitsHookEvent();
    $proof = benefitsHookProof($entry);
    $choiceProof = benefitsHookProof($choice);
    $proof['choice_proof'] = $choiceProof;
    $paid = Mockery::mock(EdnaPaidFlowGuard::class);
    $paid->shouldReceive('context')->once()->andReturn(['proof' => $proof, 'menu_id' => 77]);
    app()->instance(EdnaPaidFlowGuard::class, $paid);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldNotReceive('resolveCurrent');
    app()->instance(EdnaMessageBinding::class, $binding);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldReceive('eligibleEntry')->withArgs(fn ($event) => $event->id === $entry->id)->once()->andReturnFalse();
    $driver->shouldReceive('eligibleEntry')->withArgs(fn ($event) => $event->id === $choice->id)->once()->andReturnTrue();
    $driver->shouldReceive('check')->once()->withArgs(fn ($event, $p) => $event->id === $choice->id && $p === $choiceProof)
        ->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id))->toMatchObject(['state' => 'cancelled', 'reason' => 'benefits_case_routing']);
    Http::assertNothingSent();
});

test('a paid binding still pending is not rediscovered concurrently by the sender', function () {
    [$send] = benefitsHookPaid();
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldNotReceive('resolveCurrent');
    app()->instance(EdnaMessageBinding::class, $binding);
    $driver = Mockery::mock(EdnaBenefitsRouting::class);
    $driver->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $driver);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id))->toMatchObject([
        'state' => 'pending', 'reason' => 'paid_native_binding_pending']);
    Http::assertNothingSent();
});

test('human acceptance during the second benefits read is the last barrier before a paid Flow', function () {
    [$send, $entry] = benefitsHookPaid();
    benefitsHookVerified($send, $entry);
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
    $attention->shouldReceive('inspectWelcome')->twice()->andReturnUsing(function () use (&$accepted) {
        return $accepted
            ? ['status' => 'preserved', 'reason' => 'operator_attention_preserved', 'owner_id' => '74827', 'session_id' => '317975']
            : ['status' => 'ready', 'owner_id' => '74827', 'session_id' => '317975'];
    });
    app()->instance(EdnaOrganicAttention::class, $attention);
    benefitsHookHttp();

    (new SendEdnaFlow($send->id))->handle();

    expect($accepted)->toBeTrue()
        ->and(DB::table('edna_flow_sends')->find($send->id))->toMatchObject([
            'state' => 'cancelled', 'reason' => 'organic_human_attention_preserved']);
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/cascade/schedule'));
});
