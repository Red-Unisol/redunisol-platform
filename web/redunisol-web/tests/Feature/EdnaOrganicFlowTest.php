<?php

use App\Jobs\ResolveEdnaIntakeBinding;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaIntake;
use App\Services\EdnaIntakePilot;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicLoan;
use App\Services\EdnaOrganicProfile;
use App\Services\EdnaOrganicTransport;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 11)->setTime(15, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('o', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', [
        'enabled' => true, 'router_enabled' => true, 'subject_id' => '2423',
        'api_key' => 'organic-flow-fixture', 'cascade_id' => '2557',
        'router_start_at' => now()->subDay()->toIso8601String(), 'router_recipients' => [],
        'intake_enabled' => true, 'intake_crm_enabled' => true, 'intake_flow_id' => '950118281197789',
        'intake_start_at' => now()->subDay()->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'organic-flow-test', 'intake_pilot_limit' => 'unlimited',
    ]);
    Queue::fake();
    Http::preventStrayRequests();
});

function organicFlowEvent(array $changes = [], array $eventChanges = []): object
{
    $message = (string) (910000 + DB::table('edna_incoming_events')->count());
    $payload = array_replace_recursive([
        'id' => $message, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->subMinutes(5)->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola, quiero consultar'],
    ], $changes);
    $id = DB::table('edna_incoming_events')->insertGetId(array_replace([
        'subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
        'status' => 'delivered', 'created_at' => now(), 'updated_at' => now(),
    ], $eventChanges));

    return DB::table('edna_incoming_events')->find($id);
}

function organicFlowMenu(array $changes = [], ?object $entry = null, ?object $choice = null): object
{
    $entry ??= organicFlowEvent();
    $choice ??= organicFlowEvent(['messageContent' => ['type' => 'LIST_PICKER', 'text' => 'Quiero un préstamo']]);
    $id = DB::table('edna_organic_menus')->insertGetId(array_replace([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => $entry->id, 'choice_event_id' => $choice->id,
        'subject_id' => '2423', 'cascade_id' => '2557',
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
        'recipient' => Crypt::encryptString('5493510000000'),
        'entry_received_at' => now()->subMinutes(5), 'expires_at' => now()->addHours(23),
        'state' => 'selected', 'choice' => 'loan', 'send_state' => 'confirmed', 'flow_send_id' => null,
        'created_at' => now(), 'updated_at' => now(),
    ], $changes));

    return DB::table('edna_organic_menus')->find($id);
}

function organicFlowPrevious(string $state = 'completed', array $changes = [], bool $withAdmission = true): object
{
    $entry = organicFlowEvent();
    $admission = $withAdmission ? (new EdnaIntakePilot)->reserve('2423', '5493510000000', '950118281197789', true) : null;
    $scope = $admission
        ? hash_hmac('sha256', 'intake-admission:'.$admission->id, config('app.key'))
        : (new EdnaFlowRouter)->scope('2423', '5493510000000');
    $id = DB::table('edna_flow_sends')->insertGetId(array_replace([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => $entry->id,
        'scope' => $scope, 'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => '950118281197789',
        'intake_admission_id' => $admission?->id, 'recipient' => Crypt::encryptString('5493510000000'),
        'state' => $state, 'entry_received_at' => now()->subHour(),
        'created_at' => now()->subHour(), 'updated_at' => now()->subHour(),
    ], $changes));

    return DB::table('edna_flow_sends')->find($id);
}

function organicFlowMenuForSend(bool $reserve = true): object
{
    config()->set('edna.organic_menu_enabled', true);
    $menu = organicFlowMenu();
    $entry = DB::table('edna_incoming_events')->find($menu->entry_event_id);
    $choice = DB::table('edna_incoming_events')->find($menu->choice_event_id);
    $payload = json_decode(Crypt::decryptString($choice->payload), true, 32, JSON_THROW_ON_ERROR);
    $payload['messageContent']['payload'] = EdnaOrganicTransport::payload($menu->request_id, 'loan');
    DB::table('edna_incoming_events')->where('id', $choice->id)->update(['payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR))]);
    $proof = fn ($event) => ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session',
        'evidence' => 'external_message_id', 'entry_event_id' => $event->id, 'entry_message_id' => $event->message_id,
        'chat_id' => '601', 'session_id' => '501', 'activity_id' => '801', 'message_id' => (string) (700 + $event->id), 'native_lead_id' => '101'];
    DB::table('edna_organic_menus')->where('id', $menu->id)->update([
        'chat_id' => 601, 'session_id' => 501, 'proof' => json_encode($proof($entry) + ['choice_proof' => $proof($choice)], JSON_THROW_ON_ERROR),
        'choice_received_at' => now()->subMinute(), 'state' => $reserve ? 'selected' : 'loan_pending',
    ]);
    if ($reserve) {
        (new EdnaFlowRouter)->startOrganicChoice($menu->id);
        DB::table('edna_organic_menus')->where('id', $menu->id)->update(['state' => 'flow_scheduled']);
    }

    return DB::table('edna_organic_menus')->find($menu->id);
}

function organicFlowReadyAttention(): array
{
    return ['status' => 'ready', 'owner_id' => '0', 'session_id' => '501'];
}

function organicFlowSendHttp(?Closure $onCascade = null, bool $timeout = false, ?Closure $onSchedule = null): void
{
    Http::fake([
        'app.edna.io/api/cascade/get-all' => function () use ($onCascade) {
            $onCascade?->__invoke();

            return Http::response([['id' => 2557, 'status' => 'ACTIVE', 'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]);
        },
        'app.edna.io/api/cascade/schedule' => function ($request) use ($timeout, $onSchedule) {
            $onSchedule?->__invoke();
            if ($timeout) {
                throw new RuntimeException('acknowledgement lost');
            }

            return Http::response(['requestId' => $request['requestId']]);
        },
    ]);
}

test('a confirmed loan choice reserves the existing v3 path from the original authenticated entry', function () {
    $menu = organicFlowMenu();
    expect(DB::table('edna_intake_admissions')->count())->toBe(0);

    $id = (new EdnaFlowRouter)->startOrganicChoice($menu->id);
    $send = DB::table('edna_flow_sends')->find($id);

    expect($id)->toBeInt()->toBeGreaterThan(0)
        ->and((int) $send->entry_event_id)->toBe((int) $menu->entry_event_id)
        ->and((int) $send->entry_event_id)->not->toBe((int) $menu->choice_event_id)
        ->and($send->scope)->toBe(hash_hmac('sha256', 'organic-menu:'.$menu->request_id, config('app.key')))
        ->and($send->flow_id)->toBe('950118281197789')
        ->and($send->state)->toBe('pending')
        ->and($send->intake_contract)->toBe(EdnaIntake::CHANNEL_CONTRACT)
        ->and($send->entry_origin)->toBe('whatsapp_directo')
        ->and(Crypt::decryptString($send->recipient))->toBe('5493510000000')
        ->and((new EdnaIntake)->canSend($send))->toBeTrue()
        ->and(DB::table('edna_organic_menus')->find($menu->id)->flow_send_id)->toBe($id)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, fn ($job) => $job->sendId === $id);
    Queue::assertPushed(ResolveEdnaIntakeBinding::class, fn ($job) => $job->flowSendId === $id && $job->requestId === 0);
    Http::assertNothingSent();
});

test('unselected unconfirmed or unrelated menu choices never consume an intake slot', function (array $changes) {
    $menu = organicFlowMenu($changes);

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0)
        ->and(DB::table('edna_intake_pilots')->count())->toBe(0);
    Queue::assertNothingPushed();
})->with([
    'not selected' => [['state' => 'pending']],
    'different choice' => [['choice' => 'budget']],
    'unconfirmed outgoing menu' => [['send_state' => 'unknown']],
    'missing choice event' => [['choice_event_id' => null]],
    'missing entry event' => [['entry_event_id' => 999999]],
    'invalid menu UUID' => [['request_id' => 'not-a-uuid']],
    'different subject' => [['subject_id' => '9999']],
    'different recipient' => [['recipient' => 'invalid-ciphertext']],
]);

test('a missing menu and an entry pretending to be its own choice cannot reserve a Flow', function () {
    $entry = organicFlowEvent();
    $menu = organicFlowMenu([], $entry, $entry);

    expect((new EdnaFlowRouter)->startOrganicChoice(999999))->toBeNull()
        ->and((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    Queue::assertNothingPushed();
});

test('the persisted original entry must agree with its authenticated payload', function (string $field) {
    $changes = match ($field) {
        'id' => ['id' => '999999'],
        'subject' => ['subjectId' => '9999'],
        'phone' => ['subscriber' => ['identifier' => '5493519999999']],
        'date' => ['receivedAt' => '2026-11-11 14:55:00'],
    };
    $entry = organicFlowEvent($changes);
    $menu = organicFlowMenu([], $entry);

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    Queue::assertNothingPushed();
})->with(['id', 'subject', 'phone', 'date']);

test('the choice must belong to the original subject and encrypted recipient', function (bool $differentSubject) {
    $choice = $differentSubject
        ? organicFlowEvent(['subjectId' => '9999'], ['subject_id' => '9999'])
        : organicFlowEvent(['subscriber' => ['identifier' => '5493519999999']]);
    $menu = organicFlowMenu([], null, $choice);

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    Queue::assertNothingPushed();
})->with([true, false]);

test('repeated calls for the same selected menu return its single send without another queue job', function () {
    $menu = organicFlowMenu();
    $router = new EdnaFlowRouter;
    $first = $router->startOrganicChoice($menu->id);
    $second = $router->startOrganicChoice($menu->id);

    expect($second)->toBe($first)
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Queue::assertPushed(ResolveEdnaIntakeBinding::class, 1);
});

test('a completed previous case reuses admission but gets a fresh menu scope despite the legacy cooldown', function () {
    $previous = organicFlowPrevious();
    $before = (array) $previous;
    $menu = organicFlowMenu();

    $id = (new EdnaFlowRouter)->startOrganicChoice($menu->id);
    $send = DB::table('edna_flow_sends')->find($id);

    expect($id)->not->toBe((int) $previous->id)
        ->and($send->scope)->not->toBe($previous->scope)
        ->and($send->intake_admission_id)->toBe($previous->intake_admission_id)
        ->and((array) DB::table('edna_flow_sends')->find($previous->id))->toBe($before)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 1);
});

test('a second organic menu cannot overlap any active Flow for the same recipient', function (string $state, bool $withAdmission) {
    $previous = organicFlowPrevious($state, [], $withAdmission);
    $menu = organicFlowMenu();
    $admissions = DB::table('edna_intake_admissions')->count();

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->find($previous->id)->state)->toBe($state)
        ->and(DB::table('edna_intake_admissions')->count())->toBe($admissions)
        ->and(DB::table('edna_incoming_events')->find($menu->entry_event_id)->router_action)->toBe('organic_active_flow');
    Queue::assertNothingPushed();
})->with([
    ['pending', true], ['sending', true], ['accepted', true], ['unknown', true], ['confirmed', true],
    ['pending', false], ['sending', false], ['accepted', false], ['unknown', false], ['confirmed', false],
]);

test('an active admission with a retained empty recipient still protects the same phone', function () {
    organicFlowPrevious('unknown', ['recipient' => null]);
    $menu = organicFlowMenu();

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
    Queue::assertNothingPushed();
});

test('an active legacy scope still protects its phone after encrypted recipient retention', function () {
    organicFlowPrevious('confirmed', ['recipient' => null, 'flow_id' => EdnaFlowRouter::FLOW_ID], false);
    $menu = organicFlowMenu();

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    Queue::assertNothingPushed();
});

test('an admission pinned to another Flow version cannot start an organic fallback', function () {
    (new EdnaIntakePilot)->reserve('2423', '5493510000000', '999999999', true);
    $menu = organicFlowMenu();

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($menu->entry_event_id)->router_action)->toBe('organic_flow_contract_changed');
    Queue::assertNothingPushed();
});

test('an active case in an older pilot blocks before a new pilot admission is reserved', function () {
    config()->set('edna.intake_pilot_id', 'older-organic-batch');
    organicFlowPrevious('confirmed');
    config()->set('edna.intake_pilot_id', 'newer-organic-batch');
    $menu = organicFlowMenu();

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and(DB::table('edna_intake_pilots')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
    Queue::assertNothingPushed();
});

test('other recipient or subject active traffic does not suppress this menu choice', function (bool $otherSubject) {
    organicFlowPrevious('confirmed', $otherSubject
        ? ['subject_id' => '9999']
        : ['recipient' => Crypt::encryptString('5493519999999')], false);
    $menu = organicFlowMenu();

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeInt()
        ->and(DB::table('edna_flow_sends')->count())->toBe(2);
    Queue::assertPushed(SendEdnaFlow::class, 1);
})->with([true, false]);

test('distinct organic menu UUIDs are serialized and a completed first case permits the next menu', function () {
    $firstMenu = organicFlowMenu();
    $secondMenu = organicFlowMenu();
    $router = new EdnaFlowRouter;
    $first = $router->startOrganicChoice($firstMenu->id);

    expect($router->startOrganicChoice($secondMenu->id))->toBeNull();
    DB::table('edna_flow_sends')->where('id', $first)->update(['state' => 'completed', 'completed_at' => now()]);
    $second = $router->startOrganicChoice($secondMenu->id);

    expect($second)->toBeInt()->not->toBe($first)
        ->and(DB::table('edna_flow_sends')->count())->toBe(2)
        ->and(DB::table('edna_flow_sends')->where('id', $first)->value('scope'))
        ->not->toBe(DB::table('edna_flow_sends')->where('id', $second)->value('scope'))
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 2);
});

test('the original website attribution survives the menu choice text', function () {
    $journeys = new AttributionJourney;
    $journey = $journeys->create(['version' => 1, 'first' => ['utm_source' => 'instagram'], 'last' => ['utm_source' => 'instagram']]);
    $entry = organicFlowEvent(['messageContent' => ['text' => 'Consulta (ref: '.$journey->id.')']]);
    $menu = organicFlowMenu([], $entry);
    $id = (new EdnaFlowRouter)->startOrganicChoice($menu->id);
    $send = DB::table('edna_flow_sends')->find($id);
    $attribution = (new EdnaIntake)->attribution($send);

    expect($send->journey_id)->toBe($journey->id)
        ->and($send->entry_origin)->toBe('website')
        ->and($attribution['first']['utm_source'])->toBe('instagram')
        ->and($attribution['last']['utm_source'])->toBe('instagram')
        ->and((new EdnaIntake)->entryContext($send)['event_id'])->toBe((int) $entry->id);
});

test('the original referral remains frozen instead of being replaced with the choice attribution', function () {
    $entry = organicFlowEvent(['messageContent' => ['referral' => ['source_id' => 'organic-fixture-ad']]]);
    $menu = organicFlowMenu([], $entry);
    $id = (new EdnaFlowRouter)->startOrganicChoice($menu->id);
    $send = DB::table('edna_flow_sends')->find($id);
    $attribution = (new EdnaIntake)->attribution($send);

    expect($send->entry_origin)->toBe('unknown')
        ->and($attribution['referral']['source_id'])->toBe('organic-fixture-ad')
        ->and($attribution['journey_id'])->toBeNull();
});

test('an unrelated saved flow id and an entry already used by another case are never reused', function () {
    $previous = organicFlowPrevious();
    $menu = organicFlowMenu(['flow_send_id' => $previous->id]);
    $duplicateEntryMenu = organicFlowMenu([], DB::table('edna_incoming_events')->find($previous->entry_event_id));

    expect((new EdnaFlowRouter)->startOrganicChoice($menu->id))->toBeNull()
        ->and((new EdnaFlowRouter)->startOrganicChoice($duplicateEntryMenu->id))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Queue::assertNothingPushed();
});

test('legacy start keeps its two argument signature and admission cooldown', function () {
    $previous = organicFlowPrevious();
    $entry = organicFlowEvent();
    $payload = json_decode(Crypt::decryptString($entry->payload), true, 32, JSON_THROW_ON_ERROR);

    expect((new EdnaFlowRouter)->start($entry, $payload))->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($entry->id)->router_action)->toBe('cooldown')
        ->and(DB::table('edna_incoming_events')->find($entry->id)->flow_send_id)->toBe($previous->id);
    Queue::assertNothingPushed();
});

test('a failed queue insert rolls back the menu mapping admission and flow ledger together', function () {
    $menu = organicFlowMenu();
    Queue::shouldReceive('connection')->once()->with('edna')->andReturnSelf();
    Queue::shouldReceive('push')->once()->andThrow(new RuntimeException('queue unavailable'));

    expect(fn () => (new EdnaFlowRouter)->startOrganicChoice($menu->id))->toThrow(RuntimeException::class)
        ->and(DB::table('edna_organic_menus')->find($menu->id)->flow_send_id)->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0)
        ->and(DB::table('edna_intake_pilots')->count())->toBe(0);
});

test('the actual organic Flow job rechecks native attention twice before its single send', function () {
    $menu = organicFlowMenuForSend();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturn(organicFlowReadyAttention());
    app()->instance(EdnaOrganicAttention::class, $attention);
    organicFlowSendHttp();

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('accepted');
    Http::assertSentCount(2);
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/cascade/schedule')
        && $r['content']['whatsappContent']['contentType'] === 'FLOW'
        && $r['content']['whatsappContent']['flowId'] === 950118281197789);
});

test('a human accepting an organic chat during queue delay cancels its pending Flow', function () {
    $menu = organicFlowMenuForSend();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturn(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
    app()->instance(EdnaOrganicAttention::class, $attention);

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('cancelled')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('preserved');
    Http::assertNothingSent();
});

test('acceptance during profile resolution is protected again when the reserved fallback actually sends', function () {
    $menu = organicFlowMenuForSend(false);
    $attended = false;
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturnUsing(function () use (&$attended) {
        return $attended ? ['status' => 'preserved', 'reason' => 'operator_attention_preserved'] : organicFlowReadyAttention();
    });
    $attention->shouldReceive('snapshot')->once()->andReturn(['dialog_tuple' => ['bindings' => []]]);
    app()->instance(EdnaOrganicAttention::class, $attention);
    $profiles = Mockery::mock(EdnaOrganicProfile::class);
    $profiles->shouldReceive('resolve')->once()->andReturnUsing(function () use (&$attended) {
        $attended = true;

        return ['status' => 'missing', 'reason' => 'complete_recent_profile_unavailable'];
    });
    (new EdnaOrganicLoan($profiles, $attention))->prepare($menu->id);
    $menu = DB::table('edna_organic_menus')->find($menu->id);
    expect($menu->state)->toBe('flow_scheduled')->and($menu->flow_send_id)->not->toBeNull();

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('cancelled');
    Http::assertNothingSent();
});

test('acceptance during channel validation is caught immediately before the organic claim', function () {
    $menu = organicFlowMenuForSend();
    $attended = false;
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturnUsing(function () use (&$attended) {
        return $attended ? ['status' => 'preserved', 'reason' => 'operator_attention_preserved'] : organicFlowReadyAttention();
    });
    app()->instance(EdnaOrganicAttention::class, $attention);
    organicFlowSendHttp(function () use (&$attended) {
        $attended = true;
    });

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('cancelled');
    Http::assertSentCount(1);
    Http::assertNotSent(fn ($r) => str_ends_with($r->url(), '/cascade/schedule'));
});

test('uncertain organic attention leaves the Flow pending and never claims a POST', function () {
    $menu = organicFlowMenuForSend();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturn(['status' => 'waiting', 'reason' => 'session_attention_unavailable']);
    app()->instance(EdnaOrganicAttention::class, $attention);

    (new SendEdnaFlow($menu->flow_send_id))->handle();
    $send = DB::table('edna_flow_sends')->find($menu->flow_send_id);

    expect($send->state)->toBe('pending')->and($send->send_started_at)->toBeNull()
        ->and($send->reason)->toBe('organic_attention_pending');
    Http::assertNothingSent();
});

test('an organic session changed or closed after reservation never receives its old Flow', function (string $status) {
    $menu = organicFlowMenuForSend();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturn(['status' => $status, 'reason' => 'native_session_changed']);
    app()->instance(EdnaOrganicAttention::class, $attention);

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('cancelled');
    Http::assertNothingSent();
})->with(['closed', 'replaced']);

test('the organic Flow send shares the bridge chat lock and can proceed after it is released', function () {
    $menu = organicFlowMenuForSend();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturn(organicFlowReadyAttention());
    app()->instance(EdnaOrganicAttention::class, $attention);
    $lock = Cache::lock('web-form-chat:601', 120, 'another-worker');
    expect($lock->get())->toBeTrue();
    (new SendEdnaFlow($menu->flow_send_id))->handle();
    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('pending');
    Http::assertNothingSent();
    $lock->release();
    organicFlowSendHttp();

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('accepted');
});

test('a missing exact organic callback proof fails closed before any provider call', function () {
    $menu = organicFlowMenuForSend();
    $proof = json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR);
    unset($proof['choice_proof']);
    DB::table('edna_organic_menus')->where('id', $menu->id)->update(['proof' => json_encode($proof)]);

    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('cancelled');
    Http::assertNothingSent();
});

test('an uncertain actual organic Flow send only reconciles on a second job', function () {
    $menu = organicFlowMenuForSend();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturn(organicFlowReadyAttention());
    app()->instance(EdnaOrganicAttention::class, $attention);
    $attempts = 0;
    organicFlowSendHttp(null, true, function () use (&$attempts) {
        $attempts++;
    });

    (new SendEdnaFlow($menu->flow_send_id))->handle();
    (new SendEdnaFlow($menu->flow_send_id))->handle();

    expect(DB::table('edna_flow_sends')->find($menu->flow_send_id)->state)->toBe('unknown');
    expect($attempts)->toBe(1);
});
