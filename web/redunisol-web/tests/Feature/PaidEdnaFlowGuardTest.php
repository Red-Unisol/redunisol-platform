<?php

use App\Jobs\ResolveEdnaIntakeBinding;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaIntake;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaPaidFlowGuard;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 11)->setTime(18, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('p', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'subject_id' => '2423',
        'api_key' => 'paid-fixture', 'cascade_id' => '2557', 'router_start_at' => now()->subDay()->toIso8601String(),
        'router_recipients' => [], 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '950118281197789', 'intake_start_at' => now()->subDay()->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'paid-direct-test', 'intake_pilot_limit' => 'unlimited']);
    Queue::fake();
    Http::preventStrayRequests();
});

function paidFlowEvent(array $changes = [], array $row = []): object
{
    $id = (string) (950000 + DB::table('edna_incoming_events')->count());
    $payload = array_replace_recursive(['id' => $id, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->subMinute()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta del anuncio']], $changes);
    $entry = DB::table('edna_incoming_events')->insertGetId(array_replace(['subject_id' => '2423', 'message_id' => $id,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)), 'status' => 'delivered',
        'created_at' => now(), 'updated_at' => now()], $row));

    return DB::table('edna_incoming_events')->find($entry);
}

function paidFlowPayload(object $event): array
{
    return json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
}

function paidFlowDecision(string $kind = 'provider_ad_referral', array $evidence = []): array
{
    return ['version' => 1, 'route' => EdnaPaidFlowGuard::ROUTE,
        'evidence' => array_replace(['kind' => $kind, 'source_id' => 'campaign-fixture-1'], $evidence)];
}

function paidFlowReserve(?object $event = null, ?array $decision = null): object
{
    $event ??= paidFlowEvent();
    $id = (new EdnaFlowRouter)->startPaidEntry($event, paidFlowPayload($event), $decision ?? paidFlowDecision());
    expect($id)->toBeInt()->toBeGreaterThan(0);

    return DB::table('edna_flow_sends')->find($id);
}

function paidFlowProof(object $event, string $session = '501'): array
{
    return ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => (int) $event->id, 'entry_message_id' => $event->message_id,
        'chat_id' => '601', 'session_id' => $session, 'activity_id' => '801', 'message_id' => (string) (700 + $event->id)];
}

function paidFlowBinding(object $send, string $session = '501', string $state = 'verified', array $changes = []): array
{
    $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
    $lead = (string) (100 + $send->id);
    $proof = array_replace(paidFlowProof($entry, $session), ['lead_id' => $lead], $changes);
    DB::table('edna_intake_bindings')->insert(['flow_send_id' => $send->id, 'entry_event_id' => $send->entry_event_id,
        'case_id' => $send->request_id, 'state' => $state, 'lead_id' => $state === 'verified' ? $lead : null,
        'proof' => $state === 'verified' ? json_encode($proof, JSON_THROW_ON_ERROR) : null,
        'verified_at' => $state === 'verified' ? now() : null, 'created_at' => now(), 'updated_at' => now()]);

    return $proof;
}

function paidFlowReady(string $session = '501'): array
{
    return ['status' => 'ready', 'owner_id' => '0', 'session_id' => $session];
}

function paidFlowHttp(?Closure $duringCascade = null): void
{
    Http::fake([
        'app.edna.io/api/cascade/get-all' => function () use ($duringCascade) {
            $duringCascade?->__invoke();

            return Http::response([['id' => 2557, 'status' => 'ACTIVE', 'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]);
        },
        'app.edna.io/api/cascade/schedule' => fn ($r) => Http::response(['requestId' => $r['requestId']]),
    ]);
}

test('paid routing reserves a real v3 from the authenticated source without creating an organic menu or choice', function () {
    $entry = paidFlowEvent();
    $original = $entry->payload;
    $send = paidFlowReserve($entry);
    $snapshot = json_decode(Crypt::decryptString($send->attribution_snapshot), true, 32, JSON_THROW_ON_ERROR);

    expect($send->flow_id)->toBe('950118281197789')->and($send->intake_contract)->toBe(EdnaIntake::CHANNEL_CONTRACT)
        ->and($send->scope)->toBe(hash_hmac('sha256', 'paid-entry:'.$entry->id, config('app.key')))
        ->and($snapshot['entry_routing'])->toBe(['version' => 1, 'route' => EdnaPaidFlowGuard::ROUTE,
            'entry_event_id' => (int) $entry->id, 'evidence' => paidFlowDecision()['evidence']])
        ->and($snapshot['status'])->toBe('unknown')->and($snapshot['first'])->toBe([])
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($entry->id)->payload)->toBe($original);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Queue::assertPushed(ResolveEdnaIntakeBinding::class, fn ($job) => $job->requestId === 0 && $job->flowSendId === $send->id);
    Http::assertNothingSent();
});

test('invalid or replayed paid decisions do not consume an admission', function (array $change) {
    $entry = paidFlowEvent();
    $decision = array_replace_recursive(paidFlowDecision(), $change);

    expect((new EdnaFlowRouter)->startPaidEntry($entry, paidFlowPayload($entry), $decision))->toBeNull()
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNothingPushed();
})->with([
    [['version' => 2]], [['route' => 'organic']], [['entry_event_id' => 99999]],
    [['evidence' => ['kind' => 'any_google_word']]], [['evidence' => ['source_id' => str_repeat('x', 129)]]],
]);

test('repeated paid callbacks retain their original single v3 reservation', function () {
    $entry = paidFlowEvent();
    $first = paidFlowReserve($entry);

    expect((new EdnaFlowRouter)->startPaidEntry($entry, paidFlowPayload($entry), paidFlowDecision()))->toBe($first->id)
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 1);
});

test('paid routing preserves an active Flow before reserving another case', function (string $state) {
    $first = paidFlowReserve();
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => $state]);
    $next = paidFlowEvent();

    expect((new EdnaFlowRouter)->startPaidEntry($next, paidFlowPayload($next), paidFlowDecision()))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
})->with(['pending', 'sending', 'accepted', 'unknown', 'confirmed']);

test('a completed old case allows a fresh paid scope while preserving its admission and source', function () {
    $first = paidFlowReserve();
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => 'completed']);
    $next = paidFlowReserve();

    expect($next->scope)->not->toBe($first->scope)
        ->and($next->intake_admission_id)->toBe($first->intake_admission_id)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_organic_menus')->count())->toBe(0);
});

test('paid sending waits for an exact stored native binding without posting or inventing a menu', function (bool $pendingRow) {
    $send = paidFlowReserve();
    if ($pendingRow) {
        paidFlowBinding($send, state: 'pending');
    }
    expect((new EdnaPaidFlowGuard)->context($send)['status'])->toBe('waiting');
    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('pending')
        ->and(DB::table('edna_flow_sends')->find($send->id)->reason)->toBe('paid_native_binding_pending')
        ->and(DB::table('edna_organic_menus')->count())->toBe(0);
    Http::assertNothingSent();
})->with([true, false]);

test('a binding under review cancels the paid pending send conservatively', function () {
    $send = paidFlowReserve();
    paidFlowBinding($send, state: 'review');
    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('cancelled');
    Http::assertNothingSent();
});

test('only an exact paid original entry subject phone and case can authorize its binding', function (string $change) {
    $send = paidFlowReserve();
    paidFlowBinding($send);
    if ($change === 'case') {
        DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->update(['case_id' => (string) Str::uuid()]);
    } else {
        $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
        $payload = paidFlowPayload($entry);
        match ($change) {
            'phone' => $payload['subscriber']['identifier'] = '5493519999999',
            'subject' => $payload['subjectId'] = '9999',
            'message' => $payload['id'] = '999999',
        };
        DB::table('edna_incoming_events')->where('id', $entry->id)->update(['payload' => Crypt::encryptString(json_encode($payload))]);
    }

    expect((new EdnaPaidFlowGuard)->context($send)['status'])->toBe('invalid');
    Http::assertNothingSent();
})->with(['case', 'phone', 'subject', 'message']);

test('the actual paid v3 send uses the existing two last native human guards without a synthetic choice', function () {
    $send = paidFlowReserve();
    paidFlowBinding($send);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturn(paidFlowReady());
    app()->instance(EdnaOrganicAttention::class, $attention);
    paidFlowHttp();

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('accepted')
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->count())->toBe(1);
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/cascade/schedule')
        && $r['content']['whatsappContent']['contentType'] === 'FLOW'
        && $r['content']['whatsappContent']['flowId'] === 950118281197789);
});

test('a human taking a paid chat during queue delay cancels v3 before any provider call', function () {
    $send = paidFlowReserve();
    paidFlowBinding($send);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturn(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
    app()->instance(EdnaOrganicAttention::class, $attention);

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('cancelled');
    Http::assertNothingSent();
});

test('human attention during paid channel validation is checked again immediately before claim', function () {
    $send = paidFlowReserve();
    paidFlowBinding($send);
    $taken = false;
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturnUsing(function () use (&$taken) {
        return $taken ? ['status' => 'preserved', 'reason' => 'operator_attention_preserved'] : paidFlowReady();
    });
    app()->instance(EdnaOrganicAttention::class, $attention);
    paidFlowHttp(function () use (&$taken) {
        $taken = true;
    });

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('cancelled');
    Http::assertSentCount(1);
});

test('a paid session with an earlier sent or completed v3 cannot send another paid v3', function (string $state) {
    $first = paidFlowReserve();
    paidFlowBinding($first);
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => 'completed']);
    $second = paidFlowReserve();
    paidFlowBinding($second);
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => $state]);

    expect((new EdnaPaidFlowGuard)->context($second)['status'])->toBe('duplicate');
    (new SendEdnaFlow($second->id))->handle();
    expect(DB::table('edna_flow_sends')->find($second->id)->state)->toBe('cancelled');
    Http::assertNothingSent();
})->with(['sending', 'accepted', 'unknown', 'confirmed', 'completed']);

test('the earlier paid reservation wins when two pending receipts resolve to the same session', function () {
    $first = paidFlowReserve();
    paidFlowBinding($first);
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => 'completed']);
    $second = paidFlowReserve();
    paidFlowBinding($second);
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => 'pending']);

    expect((new EdnaPaidFlowGuard)->context(DB::table('edna_flow_sends')->find($first->id))['status'])->toBe('ready')
        ->and((new EdnaPaidFlowGuard)->context($second)['status'])->toBe('duplicate');
});

test('a distinct new session is not held by a completed paid case or its old admission scope', function () {
    $first = paidFlowReserve();
    paidFlowBinding($first);
    DB::table('edna_flow_sends')->where('id', $first->id)->update(['state' => 'completed']);
    $second = paidFlowReserve();
    paidFlowBinding($second, '502');

    expect((new EdnaPaidFlowGuard)->context($second)['status'])->toBe('ready');
});

test('plain followups retain paid routing only with the same verified native session subject and phone', function (string $change) {
    $send = paidFlowReserve();
    paidFlowBinding($send);
    $entry = paidFlowEvent($change === 'phone' ? ['subscriber' => ['identifier' => '5493519999999']] : []);
    $proof = paidFlowProof($entry, $change === 'session' ? '502' : '501');
    if ($change === 'unverified') {
        $proof['verified'] = false;
    }

    expect((new EdnaPaidFlowGuard)->continuesSession($proof, $change === 'subject' ? '9999' : '2423'))->toBe($change === 'none');
    Http::assertNothingSent();
})->with(['none', 'phone', 'session', 'subject', 'unverified']);

test('a tracked paid click preserves its actual journey and rejects evidence for another journey', function (bool $wrong) {
    $journeys = new AttributionJourney;
    $journey = $journeys->create(['version' => 1, 'first' => ['utm_source' => 'google', 'utm_medium' => 'cpc'],
        'last' => ['utm_source' => 'google', 'utm_medium' => 'cpc']]);
    $entry = paidFlowEvent(['messageContent' => ['text' => 'Consulta (ref: '.$journey->id.')']]);
    $decision = paidFlowDecision('tracked_paid_click', ['journey_id' => $wrong ? 'another-journey' : $journey->id]);
    $id = (new EdnaFlowRouter)->startPaidEntry($entry, paidFlowPayload($entry), $decision);
    if ($wrong) {
        expect($id)->toBeNull()->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    } else {
        $send = DB::table('edna_flow_sends')->find($id);
        $snapshot = (new EdnaIntake)->attribution($send);
        expect($snapshot['status'])->toBe('resolved')->and($snapshot['journey_id'])->toBe($journey->id)
            ->and($snapshot['first']['utm_source'])->toBe('google')
            ->and($snapshot['entry_routing']['evidence']['journey_id'])->toBe($journey->id);
    }
})->with([true, false]);

test('a preserved old pending menu does not override its new paid direct routing receipt', function () {
    $send = paidFlowReserve();
    paidFlowBinding($send);
    DB::table('edna_organic_menus')->insert(['request_id' => (string) Str::uuid(), 'entry_event_id' => $send->entry_event_id,
        'subject_id' => '2423', 'cascade_id' => '2557', 'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
        'recipient' => Crypt::encryptString('5493510000000'), 'state' => 'preserved', 'reason' => 'paid_entry_routed_direct_v3',
        'send_state' => 'pending', 'entry_received_at' => now()->subMinute(), 'expires_at' => now()->addHours(23),
        'created_at' => now(), 'updated_at' => now()]);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturn(paidFlowReady());
    app()->instance(EdnaOrganicAttention::class, $attention);
    paidFlowHttp();

    (new SendEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('accepted')
        ->and(DB::table('edna_organic_menus')->first()->state)->toBe('preserved')
        ->and(DB::table('edna_organic_menus')->first()->choice_event_id)->toBeNull();
});

test('an unresolved recent paid receipt postpones a general greeting without claiming a native session', function (string $state) {
    $send = paidFlowReserve();
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => $state]);
    $guard = new EdnaPaidFlowGuard;
    $next = paidFlowEvent();

    expect($guard->pendingForRecipient('2423', (new AttributionJourney)->phoneHash('5493510000000')))->toBeTrue()
        ->and($guard->continuesSession(paidFlowProof($next), '2423'))->toBeFalse();
    Http::assertNothingSent();
})->with(['pending', 'sending', 'accepted', 'unknown', 'confirmed']);

test('a pending binding becomes a verified paid continuation only after its exact native proof exists', function () {
    $send = paidFlowReserve();
    paidFlowBinding($send, state: 'pending');
    $guard = new EdnaPaidFlowGuard;
    $hash = (new AttributionJourney)->phoneHash('5493510000000');
    expect($guard->pendingForRecipient('2423', $hash))->toBeTrue();
    DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->delete();
    paidFlowBinding($send);
    $next = paidFlowEvent();

    expect($guard->pendingForRecipient('2423', $hash))->toBeFalse()
        ->and($guard->continuesSession(paidFlowProof($next), '2423'))->toBeTrue();
});

test('provisional paid waiting is bounded by phone subject age and active send state', function (string $change) {
    $send = paidFlowReserve();
    $hash = (new AttributionJourney)->phoneHash('5493510000000');
    $subject = '2423';
    match ($change) {
        'phone' => $hash = (new AttributionJourney)->phoneHash('5493519999999'),
        'subject' => $subject = '9999',
        'stale' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['entry_received_at' => now()->subHours(23)->subSecond()]),
        'completed' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'completed']),
        'cancelled' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'cancelled']),
    };

    expect((new EdnaPaidFlowGuard)->pendingForRecipient($subject, $hash))->toBeFalse();
})->with(['phone', 'subject', 'stale', 'completed', 'cancelled']);

test('an expired confirmed paid form permits reservation but only a different verified session can send', function (bool $sameSession) {
    $first = paidFlowReserve();
    paidFlowBinding($first);
    DB::table('edna_flow_sends')->where('id', $first->id)->update([
        'state' => 'confirmed', 'entry_received_at' => now()->subHours(24),
    ]);
    $second = paidFlowReserve();
    paidFlowBinding($second, $sameSession ? '501' : '502');
    $context = (new EdnaPaidFlowGuard)->context($second);
    expect($context['status'])->toBe($sameSession ? 'duplicate' : 'ready');
    if (! $sameSession) {
        $attention = Mockery::mock(EdnaOrganicAttention::class);
        $attention->shouldReceive('inspectWelcome')->twice()->andReturn(paidFlowReady('502'));
        app()->instance(EdnaOrganicAttention::class, $attention);
        paidFlowHttp();
    }

    (new SendEdnaFlow($second->id))->handle();

    expect(DB::table('edna_flow_sends')->find($second->id)->state)->toBe($sameSession ? 'cancelled' : 'accepted')
        ->and(DB::table('edna_flow_sends')->find($first->id)->state)->toBe('confirmed');
    if ($sameSession) {
        Http::assertNothingSent();
    }
})->with([true, false]);

test('expired uncertain transports and a recent confirmed transport still block new paid reservations', function (string $state) {
    $first = paidFlowReserve();
    DB::table('edna_flow_sends')->where('id', $first->id)->update([
        'state' => $state, 'entry_received_at' => $state === 'confirmed' ? now()->subHours(22) : now()->subHours(24),
    ]);
    $next = paidFlowEvent();

    expect((new EdnaFlowRouter)->startPaidEntry($next, paidFlowPayload($next), paidFlowDecision()))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Http::assertNothingSent();
})->with(['pending', 'sending', 'accepted', 'unknown', 'confirmed']);

test('the expired confirmed exception does not change organic loan admission protection', function () {
    $first = paidFlowReserve();
    DB::table('edna_flow_sends')->where('id', $first->id)->update([
        'state' => 'confirmed', 'entry_received_at' => now()->subHours(24),
    ]);
    $entry = paidFlowEvent();
    $choice = paidFlowEvent(['messageContent' => ['type' => 'LIST_PICKER', 'text' => 'Quiero un préstamo']]);
    $menu = DB::table('edna_organic_menus')->insertGetId(['request_id' => (string) Str::uuid(),
        'entry_event_id' => $entry->id, 'choice_event_id' => $choice->id, 'subject_id' => '2423', 'cascade_id' => '2557',
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'recipient' => Crypt::encryptString('5493510000000'),
        'state' => 'selected', 'choice' => 'loan', 'send_state' => 'confirmed',
        'entry_received_at' => now(), 'expires_at' => now()->addDay(), 'created_at' => now(), 'updated_at' => now()]);

    expect((new EdnaFlowRouter)->startOrganicChoice($menu))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
});
