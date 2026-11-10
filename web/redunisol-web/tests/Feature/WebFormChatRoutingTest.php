<?php

use App\Jobs\LinkWebFormChat;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\WebFormChatRouting;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 10)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('r', 32)));
    config()->set('edna', ['enabled' => true, 'subject_id' => '2423',
        'kestra_url' => 'https://kestra.example.test/incoming',
        'intake_entry_scope' => 'sales_channel', 'intake_crm_enabled' => true,
        'intake_sales_channel_start_at' => now()->subDay()->toIso8601String()]);
    Http::preventStrayRequests();
    Http::fake([]);
    Queue::fake();
});

function routeWebInput(): array
{
    return ['celular' => '3510000000', 'cuil' => '20301234563',
        '_journey_links' => ['submission_id' => (string) Str::uuid()]];
}

function routeIncomingEvent(string $text = 'Hola', string $phone = '5493510000000'): object
{
    $message = (string) (120000 + DB::table('edna_incoming_events')->count());
    $payload = ['id' => $message, 'subjectId' => '2423', 'subscriber' => ['identifier' => $phone],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => $text]];
    $id = DB::table('edna_incoming_events')->insertGetId([
        'subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
        'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
    ]);

    return DB::table('edna_incoming_events')->find($id);
}

function routePayload(object $event): array
{
    return json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
}

function routeHistory(array $overrides = []): object
{
    $event = routeIncomingEvent();
    DB::table('web_form_chat_routes')->insert(array_replace([
        'entry_event_id' => $event->id, 'submission_id' => (string) Str::uuid(),
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
        'state' => 'routed', 'proof' => json_encode([
            'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id', 'verified' => true,
            'chat_id' => '801', 'session_id' => '802', 'message_id' => '803', 'activity_id' => '804',
            'entry_event_id' => $event->id, 'entry_message_id' => $event->message_id,
        ]),
        'available_at' => now()->subMinutes(2), 'enqueued_at' => now()->subMinutes(2),
        'created_at' => now()->subMinutes(2), 'updated_at' => now()->subMinutes(2),
    ], $overrides));

    return DB::table('web_form_chat_routes')->where('entry_event_id', $event->id)->first();
}

test('a ready referenced continuation schedules one route without another form or CRM write', function () {
    $input = routeWebInput();
    $reference = app(WebFormReceipt::class)->register($input);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700', 'contact_id' => '710'], true);
    $event = routeIncomingEvent('Ya completé (solicitud: '.$reference.')');

    (new ReceiveEdnaInKestra($event->id))->handle();
    (new ReceiveEdnaInKestra($event->id))->handle();

    $row = DB::table('web_form_chat_routes')->first();
    expect($row->entry_event_id)->toBe($event->id)->and($row->submission_id)->toBe($input['_journey_links']['submission_id'])
        ->and($row->state)->toBe('pending')->and($row->proof)->toBeNull()
        ->and($row->phone_hash)->toBe((new AttributionJourney)->phoneHash('5493510000000'))
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $event->id);
    Queue::assertPushed(LinkWebFormChat::class, 1);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
});

test('a late successful web acknowledgement wakes the original waiting continuation once', function () {
    $input = routeWebInput();
    $reference = app(WebFormReceipt::class)->register($input);
    $event = routeIncomingEvent('(solicitud: '.$reference.')');
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect(DB::table('web_form_continuations')->first()->state)->toBe('waiting')
        ->and(DB::table('web_form_chat_routes')->count())->toBe(0);
    Queue::assertNotPushed(LinkWebFormChat::class);

    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700', 'contact_id' => '710'], true);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700', 'contact_id' => '710'], true);

    expect(DB::table('web_form_chat_routes')->count())->toBe(1)
        ->and(DB::table('web_form_chat_routes')->first()->submission_id)->toBe($input['_journey_links']['submission_id']);
    Queue::assertPushed(LinkWebFormChat::class, 1);
    Http::assertNothingSent();
});

test('scheduling the same event preserves its original case and uncertain write state', function () {
    $event = routeIncomingEvent();
    $submission = (string) Str::uuid();
    $routing = app(WebFormChatRouting::class);
    expect($routing->schedule($event->id, $submission))->toBeTrue();
    DB::table('web_form_chat_routes')->update(['state' => 'uncertain', 'link_state' => 'unknown']);

    expect($routing->schedule($event->id, $submission))->toBeFalse()
        ->and($routing->schedule($event->id, (string) Str::uuid()))->toBeFalse()
        ->and(DB::table('web_form_chat_routes')->first()->submission_id)->toBe($submission)
        ->and(DB::table('web_form_chat_routes')->first()->state)->toBe('uncertain')
        ->and(DB::table('web_form_chat_routes')->first()->link_state)->toBe('unknown');
    Queue::assertPushed(LinkWebFormChat::class, 1);
});

test('failed web persistence never schedules a chat route', function () {
    $input = routeWebInput();
    $reference = app(WebFormReceipt::class)->register($input);
    $event = routeIncomingEvent('(solicitud: '.$reference.')');
    (new ReceiveEdnaInKestra($event->id))->handle();
    app(WebFormReceipt::class)->result($input, ['ok' => false], false);

    expect(DB::table('web_form_continuations')->first()->state)->toBe('review')
        ->and(DB::table('web_form_chat_routes')->count())->toBe(0);
    Queue::assertNotPushed(LinkWebFormChat::class);
    Http::assertNothingSent();
});

test('a later plain message only schedules exact-message discovery and does not select a historical case by phone', function (string $state) {
    routeHistory(['state' => $state, 'reason' => $state === 'waiting' ? 'commercial_seller_not_ready' : null]);
    $event = routeIncomingEvent('Hola, volví a consultar');
    (new ReceiveEdnaInKestra($event->id))->handle();

    $continuation = DB::table('web_form_continuations')->where('entry_event_id', $event->id)->first();
    $route = DB::table('web_form_chat_routes')->where('entry_event_id', $event->id)->first();
    expect($continuation->state)->toBe('waiting')->and($continuation->reason)->toBe('web_chat_reentry')
        ->and($continuation->proof_source)->toBe('reentry')->and($continuation->submission_id)->toBeNull()
        ->and($continuation->lead_id)->toBeNull()->and($route->submission_id)->toBeNull()
        ->and($route->proof)->toBeNull()->and($route->deal_id)->toBeNull()->and($route->seller_id)->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $event->id);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
})->with(['routed', 'linked', 'preserved', 'waiting']);

test('a fresh explicit reference takes precedence over the historical phone hint', function () {
    $old = routeHistory();
    $input = routeWebInput();
    $reference = app(WebFormReceipt::class)->register($input);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700'], true);
    $event = routeIncomingEvent('(solicitud: '.$reference.')');
    (new ReceiveEdnaInKestra($event->id))->handle();

    $route = DB::table('web_form_chat_routes')->where('entry_event_id', $event->id)->first();
    expect($route->submission_id)->toBe($input['_journey_links']['submission_id'])->not->toBe($old->submission_id)
        ->and(DB::table('web_form_continuations')->where('entry_event_id', $event->id)->first()->proof_source)->toBe('reference');
});

test('a malformed explicit reference cannot adopt a historical route by phone', function () {
    routeHistory();
    $event = routeIncomingEvent('(solicitud: invalid)');
    (new ReceiveEdnaInKestra($event->id))->handle();

    expect(DB::table('web_form_continuations')->where('entry_event_id', $event->id)->first()->state)->toBe('review')
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $event->id)->exists())->toBeFalse();
    Queue::assertNotPushed(LinkWebFormChat::class);
    Http::assertNothingSent();
});

test('incomplete prior work is not a reentry hint', function (string $state) {
    routeHistory(['state' => $state, 'proof' => $state === 'routed' ? null : json_encode(['chat_id' => '801'])]);
    $event = routeIncomingEvent();
    expect(app(WebFormChatRouting::class)->receiveReentry($event, routePayload($event)))->toBeFalse()
        ->and(DB::table('web_form_continuations')->count())->toBe(0);
    Queue::assertNotPushed(LinkWebFormChat::class);
})->with(['pending', 'waiting', 'review', 'uncertain', 'routed']);

test('another phone or mismatched authenticated event cannot adopt a reentry hint', function (string $kind) {
    routeHistory();
    $event = routeIncomingEvent(phone: $kind === 'phone' ? '5493510000001' : '5493510000000');
    $payload = routePayload($event);
    if ($kind === 'message') {
        $payload['id'] = '999999';
    } elseif ($kind === 'subject') {
        $payload['subjectId'] = '9999';
    }
    expect(app(WebFormChatRouting::class)->receiveReentry($event, $payload))->toBeFalse()
        ->and(DB::table('web_form_continuations')->count())->toBe(0);
    Queue::assertNotPushed(LinkWebFormChat::class);
})->with(['phone', 'message', 'subject']);

test('an unproven incomplete or uncertain historical route is not a reentry hint', function (string $kind) {
    $history = routeHistory(['state' => 'waiting']);
    $proof = json_decode($history->proof, true);
    $changes = match ($kind) {
        'source' => ['proof' => json_encode(array_replace($proof, ['source' => 'phone_match']))],
        'evidence' => ['proof' => json_encode(array_replace($proof, ['evidence' => 'message_text']))],
        'not_verified' => ['proof' => json_encode(array_replace($proof, ['verified' => false]))],
        'string_verified' => ['proof' => json_encode(array_replace($proof, ['verified' => 'true']))],
        'invalid_chat' => ['proof' => json_encode(array_replace($proof, ['chat_id' => '0']))],
        'missing_activity' => ['proof' => json_encode(array_diff_key($proof, ['activity_id' => true]))],
        'different_entry' => ['proof' => json_encode(array_replace($proof, ['entry_event_id' => $history->entry_event_id + 1]))],
        'null_submission' => ['submission_id' => null],
        'invalid_submission' => ['submission_id' => 'not-a-submission-id'],
        'invalid_json' => ['proof' => '{'],
        'partial_completed' => ['state' => 'routed', 'proof' => json_encode(['chat_id' => '801'])],
        'partial_waiting' => ['proof' => json_encode(['chat_id' => '801'])],
        'sending' => ['transfer_state' => 'sending'],
        'unknown' => ['transfer_state' => 'unknown'],
        'completed_unknown' => ['state' => 'preserved', 'transfer_state' => 'unknown'],
    };
    DB::table('web_form_chat_routes')->where('entry_event_id', $history->entry_event_id)->update($changes);
    $event = routeIncomingEvent();

    expect(app(WebFormChatRouting::class)->receiveReentry($event, routePayload($event)))->toBeFalse()
        ->and(DB::table('web_form_continuations')->count())->toBe(0);
    Queue::assertNotPushed(LinkWebFormChat::class);
    Http::assertNothingSent();
})->with(['source', 'evidence', 'not_verified', 'string_verified', 'invalid_chat', 'missing_activity',
    'different_entry', 'null_submission', 'invalid_submission', 'invalid_json', 'partial_completed',
    'partial_waiting', 'sending', 'unknown', 'completed_unknown']);

test('poll recovers due work in bounded batches without resetting stages or active leases', function () {
    $first = routeHistory(['state' => 'waiting', 'link_state' => 'linked', 'transfer_state' => 'pending']);
    $second = routeHistory(['state' => 'pending', 'lease_token' => (string) Str::uuid(), 'lease_until' => now()->subSecond()]);
    routeHistory(['state' => 'waiting', 'lease_until' => now()->addMinute()]);
    routeHistory(['state' => 'waiting', 'available_at' => now()->addMinute()]);
    routeHistory(['state' => 'pending', 'enqueued_at' => now()]);
    routeHistory(['state' => 'uncertain']);
    routeHistory(['state' => 'routed']);
    $routing = app(WebFormChatRouting::class);

    expect($routing->poll(1))->toBe(1)->and($routing->poll(1))->toBe(1)->and($routing->poll(1))->toBe(0)
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $first->entry_event_id)->first()->link_state)->toBe('linked');
    Queue::assertPushed(LinkWebFormChat::class, 2);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $first->entry_event_id);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $second->entry_event_id);
    Http::assertNothingSent();
});

test('old waiting retries do not starve newer overdue work', function () {
    for ($i = 0; $i < 25; $i++) {
        routeHistory(['state' => 'waiting', 'created_at' => now()->subDay(), 'available_at' => now()->subMinute()]);
    }
    $overdue = routeHistory(['state' => 'pending', 'created_at' => now()->subMinutes(30), 'available_at' => now()->subMinutes(30)]);

    expect(app(WebFormChatRouting::class)->poll())->toBe(25);
    Queue::assertPushed(LinkWebFormChat::class, 25);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $overdue->entry_event_id);
    expect(Queue::pushed(LinkWebFormChat::class)->first()->entryEventId)->toBe($overdue->entry_event_id);
    Http::assertNothingSent();
});

test('legacy null availability falls back to creation age in recovery order', function () {
    $legacy = routeHistory(['state' => 'waiting', 'created_at' => now()->subHour(), 'available_at' => null]);
    routeHistory(['state' => 'pending', 'created_at' => now()->subMinutes(30), 'available_at' => now()->subMinutes(5)]);

    expect(app(WebFormChatRouting::class)->poll(1))->toBe(1);
    Queue::assertPushed(LinkWebFormChat::class, 1);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $legacy->entry_event_id);
    Http::assertNothingSent();
});

test('poll command rejects invalid actions and limits', function (string $action, string $limit) {
    routeHistory(['state' => 'waiting']);
    $this->artisan('edna:web-chat-routes', ['action' => $action, '--limit' => $limit])->assertFailed();
    Queue::assertNothingPushed();
})->with([['poll', '0'], ['poll', '101'], ['retry', '25']]);

test('poll only wakes due uncertain transfers for the linkers read-only reconciliation path', function () {
    $unknown = routeHistory(['state' => 'unknown', 'link_state' => 'linked', 'transfer_state' => 'unknown']);
    routeHistory(['state' => 'unknown', 'transfer_state' => 'sending', 'available_at' => now()->addMinutes(5)]);
    routeHistory(['state' => 'unknown', 'transfer_state' => 'pending']);

    expect(app(WebFormChatRouting::class)->poll())->toBe(1)
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $unknown->entry_event_id)->first()->transfer_state)->toBe('unknown');
    Queue::assertPushed(LinkWebFormChat::class, 1);
    Queue::assertPushed(LinkWebFormChat::class, fn ($job) => $job->entryEventId === $unknown->entry_event_id);
    Http::assertNothingSent();
});

test('poll command enqueues due work without contacting Bitrix', function () {
    routeHistory(['state' => 'pending']);
    $this->artisan('edna:web-chat-routes', ['--limit' => '1'])->expectsOutput('{"enqueued":1}')->assertSuccessful();
    Queue::assertPushed(LinkWebFormChat::class, 1);
    Http::assertNothingSent();
});

test('routing status shows durable outcomes without dispatching or changing work', function () {
    $route = routeHistory(['state' => 'unknown', 'transfer_state' => 'unknown', 'reason' => 'transfer_result_uncertain']);
    $before = (array) DB::table('web_form_chat_routes')->where('entry_event_id', $route->entry_event_id)->first();
    $this->artisan('edna:web-chat-routes', ['action' => 'status', '--limit' => '1'])
        ->expectsOutputToContain('transfer_result_uncertain')->assertSuccessful();
    expect((array) DB::table('web_form_chat_routes')->where('entry_event_id', $route->entry_event_id)->first())->toBe($before);
    Queue::assertNothingPushed();
    Http::assertNothingSent();
});
