<?php

use App\Jobs\ProcessEdnaIntake;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ResolveEdnaIntakeBinding;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaIntake;
use App\Services\EdnaIntakeBinding;
use Illuminate\Contracts\Queue\Job;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 4)->setTime(14, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('u', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'webhook_key' => 'unified-test', 'auth_header' => 'Authorization',
        'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/incoming',
        'router_enabled' => true, 'router_start_at' => now()->subDays(3)->toIso8601String(), 'router_recipients' => [],
        'api_key' => 'outgoing-test', 'cascade_id' => '2557', 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '999000111222333', 'intake_start_at' => now()->subDays(2)->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'sales-channel-test', 'intake_pilot_limit' => 'unlimited',
        'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/test']);
    Http::preventStrayRequests();
    Http::fake(['kestra.example.test/incoming' => fn ($r) => Http::response([
        'ok' => true, 'event_key' => $r['subjectId'].':'.$r['id'], 'kind' => 'router_entry',
    ])]);
    Queue::fake();
});

function unifiedIntakeEvent(array $changes = []): object
{
    $payload = array_replace_recursive(['id' => (string) (8000 + DB::table('edna_incoming_events')->count()),
        'subjectId' => 2423, 'subscriber' => ['identifier' => '5493510000000'], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola, quisiera información']], $changes);
    test()->postJson('/api/webhooks/edna/incoming', $payload, ['Authorization' => 'Token unified-test'])->assertOk();

    return DB::table('edna_incoming_events')->latest('id')->first();
}

function unifiedIntakeSend(array $changes = []): object
{
    $event = unifiedIntakeEvent($changes);
    (new ReceiveEdnaInKestra($event->id))->handle();

    return DB::table('edna_flow_sends')->where('entry_event_id', $event->id)->first();
}

function unifiedIntakeReply(?object $send = null, array $answer = []): object
{
    $send ??= unifiedIntakeSend();
    DB::table('edna_flow_sends')->where('id', $send->id)->update([
        'state' => 'confirmed', 'outgoing_message_id' => '9900', 'send_started_at' => now(),
    ]);
    $event = unifiedIntakeEvent(['replyOutMessageId' => '9900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode($answer + ['provincia' => 'catamarca',
            'situacion_catamarca' => 'policia', 'banco_catamarca' => 'nacion', 'cuil' => '20301234563'])]]);
    (new ReceiveEdnaInKestra($event->id))->handle();

    return DB::table('edna_intake_requests')->where('flow_send_id', $send->id)->first();
}

function unifiedIntakeProof(object $send): array
{
    $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);

    return ['version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
        'lead_id' => '700', 'chat_id' => '701', 'session_id' => '702', 'message_id' => '703',
        'entry_event_id' => (int) $entry->id, 'entry_message_id' => $entry->message_id,
        'evidence' => 'external_message_id'];
}

function unifiedIntakeResolver(?array $proof, ?int $calls = null): void
{
    $resolver = Mockery::mock(EdnaIntakeBinding::class);
    $expectation = $resolver->shouldReceive('resolve')->andReturn($proof);
    $resolver->shouldReceive('verified')->andReturn($proof);
    if ($calls !== null) {
        $expectation->times($calls);
    }
    app()->instance(EdnaIntakeBinding::class, $resolver);
}

function unifiedProfileReview(): object
{
    $request = unifiedIntakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    DB::table('edna_intake_bindings')->insert([
        'flow_send_id' => $send->id, 'case_id' => $send->request_id, 'entry_event_id' => $send->entry_event_id,
        'lead_id' => '700', 'state' => 'verified', 'proof' => json_encode(unifiedIntakeProof($send)),
        'verified_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);
    DB::table('edna_intake_requests')->where('id', $request->id)->update([
        'state' => 'review', 'reason' => 'bound_profile_conflict', 'lead_id' => '700', 'contact_id' => '',
    ]);

    return DB::table('edna_intake_requests')->find($request->id);
}

test('audited empty profile rescue processes the saved answer on its original bound lead once', function () {
    $request = unifiedProfileReview();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    $before = (array) $send;
    $binding = (array) DB::table('edna_intake_bindings')->first();
    $args = ['action' => 'rescue', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--expected-lead' => '700', '--confirmed-no-writes' => true];
    Queue::fake();

    $this->artisan('edna:intake', ['action' => 'rescue', 'id' => $request->id])->assertSuccessful();
    Queue::assertNothingPushed();
    $this->artisan('edna:intake', $args)->assertSuccessful();
    $this->artisan('edna:intake', $args)->assertFailed();
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
    Queue::assertNotPushed(SendEdnaFlow::class);
    expect((array) DB::table('edna_flow_sends')->find($send->id))->toBe($before)
        ->and((array) DB::table('edna_intake_bindings')->first())->toBe($binding)
        ->and(DB::table('edna_intake_requests')->find($request->id)->answer)->toBe($request->answer)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_requests')->count())->toBe(1);

    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'lead_id' => '700', 'contact_id' => '710',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['case_id'] === $send->request_id
        && $r['contract'] === EdnaIntake::CHANNEL_CONTRACT && $r['crm_binding']['lead_id'] === '700'
        && $r['answer']['cuil'] === '20301234563');
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('synced')
        ->and(DB::table('edna_intake_requests')->find($request->id)->lead_id)->toBe('700');
    $this->artisan('edna:intake', $args)->assertSuccessful();
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
});

test('bound profile rescue requires exact saved identity proof and a prewrite review', function (string $condition) {
    $request = unifiedProfileReview();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    $args = ['action' => 'rescue', 'id' => $request->id, '--apply' => true,
        '--expected-case' => $send->request_id, '--expected-lead' => '700', '--confirmed-no-writes' => true];
    match ($condition) {
        'missing_expected_lead' => $args['--expected-lead'] = '',
        'wrong_expected_lead' => $args['--expected-lead'] = '701',
        'recorded_other_lead' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['lead_id' => '701']),
        'recorded_contact' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['contact_id' => '710']),
        'different_reason' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['reason' => 'bound_identity_conflict']),
        'unknown', 'processing', 'pending' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => $condition]),
        'missing_binding' => DB::table('edna_intake_bindings')->delete(),
        'unverified_binding' => DB::table('edna_intake_bindings')->update(['state' => 'pending']),
        'different_binding_case' => DB::table('edna_intake_bindings')->update(['case_id' => '00000000-0000-4000-8000-000000000001']),
        'different_entry_message' => DB::table('edna_intake_bindings')->update(['proof' => json_encode(array_replace(unifiedIntakeProof($send), ['entry_message_id' => '99999']))]),
        'legacy_contract' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['intake_contract' => null]),
        'missing_answer' => DB::table('edna_intake_requests')->where('id', $request->id)->update(['answer' => null]),
        'mismatched_response' => DB::table('edna_flow_sends')->where('id', $send->id)->update(['response_event_id' => 999999]),
        'missing_audit' => $args['--confirmed-no-writes'] = false,
    };
    Queue::fake();
    $this->artisan('edna:intake', $args)->assertFailed();
    Queue::assertNothingPushed();
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '/bitrix24_whatsapp_intake/'));
})->with(['missing_expected_lead', 'wrong_expected_lead', 'recorded_other_lead', 'recorded_contact', 'different_reason',
    'unknown', 'processing', 'pending', 'missing_binding', 'unverified_binding', 'different_binding_case',
    'different_entry_message', 'legacy_contract', 'missing_answer', 'mismatched_response', 'missing_audit']);

function unifiedLegacyWebsiteSend(): object
{
    config()->set('edna.intake_entry_scope', 'website');
    $journey = (new AttributionJourney)->create(['version' => 1,
        'first' => ['utm_source' => 'ig'], 'last' => ['utm_source' => 'ig']]);

    return unifiedIntakeSend(['messageContent' => ['text' => 'Hola (ref: '.$journey->id.')']]);
}

test('sales entries reserve the published intake without a fictitious website journey', function (string $type) {
    $send = unifiedIntakeSend(['messageContent' => ['type' => $type]]);
    $service = new EdnaIntake;
    $attribution = $service->attribution($send);
    expect($send->flow_id)->toBe('999000111222333')->and($send->intake_contract)->toBe(EdnaIntake::CHANNEL_CONTRACT)
        ->and($send->entry_origin)->toBe('whatsapp_directo')->and($send->journey_id)->toBeNull()
        ->and($attribution['status'])->toBe('unknown')->and($attribution['first'])->toBe([])
        ->and($attribution['last'])->toBe([])->and($attribution['wa']['WA_ENTRY'])->toBe('whatsapp_directo')
        ->and($service->entryContext($send)['message_id'])->toBe('8000')->and($service->canSend($send))->toBeTrue()
        ->and(DB::table('attribution_journeys')->count())->toBe(0)
        ->and(DB::table('edna_intake_pilots')->first()->capacity)->toBe(0)
        ->and(DB::table('edna_incoming_events')->first()->outcome)->toBe('unified_intake_entry');
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Queue::assertPushed(ResolveEdnaIntakeBinding::class, fn ($job) => $job->flowSendId === $send->id && $job->requestId === 0);
    Http::assertNothingSent();
})->with(['TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO', 'LIST_PICKER']);

test('website scope preserves the existing route without a channel contract', function () {
    config()->set('edna.intake_entry_scope', 'website');
    $send = unifiedIntakeSend();
    expect($send->flow_id)->toBe(EdnaFlowRouter::FLOW_ID)->and($send->intake_contract)->toBeNull()
        ->and($send->entry_origin)->toBeNull()->and($send->attribution_snapshot)->toBeNull();
    Queue::assertNotPushed(ResolveEdnaIntakeBinding::class);
});

test('a sales scope gate cannot fall back to sending the legacy Flow', function (string $gate) {
    match ($gate) {
        'intake' => config()->set('edna.intake_enabled', false),
        'flow' => config()->set('edna.intake_flow_id', ''),
        'recipient' => config()->set('edna.intake_recipients', ['5493519999999']),
        'router' => config()->set('edna.router_enabled', false),
    };
    $event = unifiedIntakeEvent();
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($event->id)->status)->toBe('delivered');
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
})->with(['intake', 'flow', 'recipient', 'router']);

test('new channel admission requires an aware cutoff and preserves the prior scope before it', function () {
    $service = new EdnaIntake;
    $event = unifiedIntakeEvent();
    $payload = json_decode(Crypt::decryptString($event->payload), true);
    config()->set('edna.intake_sales_channel_start_at', now()->addMinute()->toIso8601String());
    expect($service->salesChannelEntry($event, $payload))->toBeFalse();
    config()->set('edna.intake_sales_channel_start_at', '2026-11-04 00:00:00');
    expect($service->salesChannelEntry($event, $payload))->toBeFalse();
    config()->set('edna.intake_sales_channel_start_at', now()->subMinute()->toIso8601String());
    $event->subject_id = '9999';
    expect($service->salesChannelEntry($event, $payload))->toBeFalse();
});

test('the authenticated inbox rejects another subject and discards forged binding context', function () {
    $this->postJson('/api/webhooks/edna/incoming', ['id' => '88', 'subjectId' => '9999'],
        ['Authorization' => 'Token unified-test'])->assertJsonPath('ignored', 1);
    expect(DB::table('edna_incoming_events')->count())->toBe(0);
    $event = unifiedIntakeEvent(['entry_context' => ['origin' => 'website'], 'crm_binding' => ['lead_id' => '999'],
        'messageContent' => ['referral' => ['source_id' => 'ad-77', 'source_url' => 'https://example.test/ad',
            'unknown_secret' => 'drop', 'body' => str_repeat('x', 2049)]]]);
    (new ReceiveEdnaInKestra($event->id))->handle();
    $stored = json_decode(Crypt::decryptString($event->payload), true);
    $send = DB::table('edna_flow_sends')->first();
    $snapshot = (new EdnaIntake)->attribution($send);
    expect($stored)->not->toHaveKeys(['entry_context', 'crm_binding'])
        ->and($stored['messageContent']['referral'])->toBe(['source_id' => 'ad-77', 'source_url' => 'https://example.test/ad'])
        ->and($send->entry_origin)->toBe('unknown')->and($snapshot['first'])->toBe([])
        ->and($snapshot['referral']['source_id'])->toBe('ad-77');
});

test('resolved website attribution is frozen and remains finishable after scope rollback', function () {
    $journey = (new AttributionJourney)->create(['version' => 1,
        'first' => ['utm_source' => 'ig', 'utm_campaign' => 'original'],
        'last' => ['utm_source' => 'ig', 'utm_campaign' => 'original']]);
    $send = unifiedIntakeSend(['messageContent' => ['text' => 'Hola (ref: '.$journey->id.')']]);
    $snapshot = (new EdnaIntake)->attribution($send);
    expect($send->entry_origin)->toBe('website')->and($snapshot['status'])->toBe('resolved')
        ->and($snapshot['last']['utm_campaign'])->toBe('original');
    DB::table('attribution_journeys')->where('id', $journey->id)->update(['expires_at' => now()->subMinute()]);
    config()->set('edna.intake_entry_scope', 'website');
    config()->set('edna.intake_sales_channel_start_at', now()->addDay()->toIso8601String());
    expect((new EdnaIntake)->attribution($send))->toBe($snapshot)->and((new EdnaIntake)->canSend($send))->toBeTrue();
    $request = unifiedIntakeReply($send);
    expect($request->state)->toBe('awaiting_binding')->and($request->flow_send_id)->toBe($send->id);
});

test('followups and duplicate callbacks retain one case admission and response', function () {
    $send = unifiedIntakeSend();
    $entryTime = now();
    $this->travel(2)->days();
    $followup = unifiedIntakeEvent();
    (new ReceiveEdnaInKestra($followup->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($followup->id)->flow_send_id)->toBe($send->id);
    $this->travelTo($entryTime);
    $request = unifiedIntakeReply($send);
    $response = DB::table('edna_incoming_events')->find($request->response_event_id);
    (new ReceiveEdnaInKestra($response->id))->handle();
    $duplicate = unifiedIntakeEvent(['replyOutMessageId' => '9900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => '{"provincia":"catamarca"}']]);
    (new ReceiveEdnaInKestra($duplicate->id))->handle();
    expect(DB::table('edna_intake_requests')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->first()->response_event_id)->toBe($response->id);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Queue::assertPushed(ResolveEdnaIntakeBinding::class, 2);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
});

test('binding can resolve before any answer without dispatching CRM processing', function () {
    $send = unifiedIntakeSend();
    unifiedIntakeResolver(unifiedIntakeProof($send), 1);
    (new ResolveEdnaIntakeBinding(0, $send->id))->handle();
    expect(DB::table('edna_intake_requests')->count())->toBe(0);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
    Http::assertNothingSent();
});

test('a missing binding only retries provider reads and eventually leaves review', function () {
    $request = unifiedIntakeReply();
    unifiedIntakeResolver(null, 2);
    $first = new ResolveEdnaIntakeBinding($request->id);
    $queue = Mockery::mock(Job::class);
    $queue->shouldReceive('attempts')->andReturn(1);
    $queue->shouldReceive('release')->once()->with(5);
    $first->setJob($queue)->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('awaiting_binding');
    $last = new ResolveEdnaIntakeBinding($request->id);
    $exhausted = Mockery::mock(Job::class);
    $exhausted->shouldReceive('attempts')->andReturn(6);
    $exhausted->shouldNotReceive('release');
    $last->setJob($exhausted)->handle();
    $current = DB::table('edna_intake_requests')->find($request->id);
    expect($current->state)->toBe('review')->and($current->reason)->toBe('crm_binding_unavailable')
        ->and($current->answer)->toBe($request->answer);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
    Http::assertNothingSent();
});

test('a verified binding atomically dispatches the stored response once', function () {
    $request = unifiedIntakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    unifiedIntakeResolver(unifiedIntakeProof($send), 1);
    (new ResolveEdnaIntakeBinding($request->id))->handle();
    (new ResolveEdnaIntakeBinding($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('pending');
    Queue::assertPushed(ProcessEdnaIntake::class, 1);
});

test('V2 processing uses trusted original entry and lead even if an answer forges them', function () {
    $request = unifiedIntakeReply(null, ['entry_context' => ['event_id' => 999], 'crm_binding' => ['lead_id' => '999'],
        'test_reference' => 'PRUEBAFORM']);
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    $proof = unifiedIntakeProof($send);
    unifiedIntakeResolver($proof, 1);
    (new ResolveEdnaIntakeBinding($request->id))->handle();
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'lead_id' => '700', 'contact_id' => '710',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['contract'] === EdnaIntake::CHANNEL_CONTRACT
        && $r['crm_binding'] === $proof && $r['entry_context']['event_id'] === $send->entry_event_id
        && $r['test_reference'] === null && $r['attribution']['wa']['WA_ENTRY'] === 'whatsapp_directo'
        && $r['case_id'] === $send->request_id && $r['flow_id'] === $send->flow_id);
    $current = DB::table('edna_intake_requests')->find($request->id);
    expect($current->state)->toBe('synced')->and($current->lead_id)->toBe('700');
});

test('processing without a binding stores the answer and queues only binding work once', function () {
    $request = unifiedIntakeReply();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'pending']);
    unifiedIntakeResolver(null, 0);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    $current = DB::table('edna_intake_requests')->find($request->id);
    expect($current->state)->toBe('awaiting_binding')->and($current->answer)->toBe($request->answer);
    Queue::assertNotPushed(ProcessEdnaIntake::class);
    Queue::assertPushed(ResolveEdnaIntakeBinding::class, 3);
    Http::assertNothingSent();
});

test('a binding for another entry stops before contacting the intake processor', function () {
    $request = unifiedIntakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    $proof = unifiedIntakeProof($send);
    $proof['entry_message_id'] = '999999';
    unifiedIntakeResolver($proof);
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'pending']);
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->reason)->toBe('crm_binding_invalid');
    Http::assertNothingSent();
});

test('an acknowledgement for another lead is uncertain and is never automatically replayed', function () {
    $request = unifiedIntakeReply();
    $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
    unifiedIntakeResolver(unifiedIntakeProof($send));
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'pending']);
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'lead_id' => '999',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('unknown');
    Http::assertSentCount(1);
});

test('PRUEBAFORM keeps its isolated legacy test contract under sales scope', function () {
    $send = unifiedIntakeSend(['messageContent' => ['text' => '(ref: PRUEBAFORM)']]);
    expect((bool) $send->intake_test)->toBeTrue()->and($send->intake_contract)->toBeNull()
        ->and((new EdnaIntake)->contractFor($send))->toBe(EdnaIntake::TEST_CONTRACT)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    Queue::assertNotPushed(ResolveEdnaIntakeBinding::class);
});

test('an unanswered current legacy website Flow upgrades in place and processes its original lead', function () {
    $send = unifiedLegacyWebsiteSend();
    expect($send->intake_contract)->toBeNull();
    config()->set('edna.intake_entry_scope', 'sales_channel');
    // The authenticated original entry predates this expansion; its existing
    // current-Flow admission may still finish on the exact original lead.
    config()->set('edna.intake_sales_channel_start_at', now()->addMinute()->toIso8601String());
    $request = unifiedIntakeReply($send);
    $upgraded = DB::table('edna_flow_sends')->find($send->id);
    expect($upgraded->intake_contract)->toBe(EdnaIntake::CHANNEL_CONTRACT)
        ->and($upgraded->entry_origin)->toBe('website')->and($upgraded->request_id)->toBe($send->request_id)
        ->and($upgraded->entry_event_id)->toBe($send->entry_event_id)->and($upgraded->journey_id)->toBe($send->journey_id)
        ->and($upgraded->intake_admission_id)->toBe($send->intake_admission_id)
        ->and($upgraded->outgoing_message_id)->toBe('9900')->and($request->state)->toBe('awaiting_binding')
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    unifiedIntakeResolver(unifiedIntakeProof($upgraded), 1);
    (new ResolveEdnaIntakeBinding($request->id))->handle();
    Http::fake(['kestra.example.test/bitrix24_whatsapp_intake/*' => fn ($r) => Http::response([
        'ok' => true, 'case_id' => $r['case_id'], 'action' => 'queued', 'lead_id' => '700',
    ])]);
    (new ProcessEdnaIntake($request->id))->handle();
    Http::assertSent(fn ($r) => $r['contract'] === EdnaIntake::CHANNEL_CONTRACT
        && $r['crm_binding']['lead_id'] === '700' && $r['case_id'] === $send->request_id
        && $r['entry_context']['event_id'] === $send->entry_event_id && $r['attribution']['wa']['WA_ENTRY'] === 'website');
    Queue::assertPushed(SendEdnaFlow::class, 1);
});

test('a predeployment pending request upgrades before any CRM call', function () {
    $send = unifiedLegacyWebsiteSend();
    $request = unifiedIntakeReply($send);
    expect($request->state)->toBe('pending');
    config()->set('edna.intake_entry_scope', 'sales_channel');
    unifiedIntakeResolver(null, 0);
    (new ProcessEdnaIntake($request->id))->handle();
    expect(DB::table('edna_flow_sends')->find($send->id)->intake_contract)->toBe(EdnaIntake::CHANNEL_CONTRACT)
        ->and(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('awaiting_binding');
    Http::assertSentCount(1); // The original legacy entry classification only.
});

test('promotion excludes uncertain or already written requests and historical Flow versions', function (string $state) {
    $send = unifiedLegacyWebsiteSend();
    $request = unifiedIntakeReply($send);
    config()->set('edna.intake_entry_scope', 'sales_channel');
    if ($state === 'historical_flow') {
        config()->set('edna.intake_flow_id', '999000444555666');
    } elseif ($state === 'written_pending') {
        DB::table('edna_intake_requests')->where('id', $request->id)->update(['lead_id' => '777']);
    } else {
        DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => $state]);
    }
    (new EdnaIntake)->promoteUnprocessedCurrentFlow($send);
    expect(DB::table('edna_flow_sends')->find($send->id)->intake_contract)->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
})->with(['unknown', 'processing', 'synced', 'review', 'written_pending', 'historical_flow']);

test('a current legacy request with an invalid original entry cannot fall back to V1 processing', function () {
    $send = unifiedLegacyWebsiteSend();
    $request = unifiedIntakeReply($send);
    config()->set('edna.intake_entry_scope', 'sales_channel');
    DB::table('edna_incoming_events')->where('id', $send->entry_event_id)->update(['payload' => 'invalid-ciphertext']);
    unifiedIntakeResolver(null, 0);
    (new ProcessEdnaIntake($request->id))->handle();
    $current = DB::table('edna_intake_requests')->find($request->id);
    expect($current->state)->toBe('review')->and($current->reason)->toBe('crm_binding_unavailable')
        ->and($current->answer)->toBe($request->answer);
    Http::assertSentCount(1); // The original legacy entry classification only.
});

test('new duplicate responses for processed legacy v3 cases are consumed after sales cutover', function (string $state) {
    $send = unifiedLegacyWebsiteSend();
    $request = unifiedIntakeReply($send);
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => $state, 'lead_id' => '777']);
    $before = (array) DB::table('edna_intake_requests')->find($request->id);
    config()->set('edna.intake_entry_scope', 'sales_channel');
    $duplicate = unifiedIntakeEvent(['replyOutMessageId' => '9900', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => '{"provincia":"cordoba"}']]);
    (new ReceiveEdnaInKestra($duplicate->id))->handle();
    $inbox = DB::table('edna_incoming_events')->find($duplicate->id);
    $currentSend = DB::table('edna_flow_sends')->find($send->id);
    expect($inbox->status)->toBe('delivered')->and($inbox->router_action)->toBe('intake_duplicate_response')
        ->and((array) DB::table('edna_intake_requests')->find($request->id))->toBe($before)
        ->and($currentSend->intake_contract)->toBeNull()->and($currentSend->response_event_id)->toBe($request->response_event_id)
        ->and($currentSend->request_id)->toBe($send->request_id)
        ->and(DB::table('edna_intake_requests')->count())->toBe(1)
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Queue::assertPushed(ProcessEdnaIntake::class, 1); // Only the original legacy response.
    Queue::assertNotPushed(ResolveEdnaIntakeBinding::class);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Http::assertSentCount(1); // Only the original legacy entry classification.
})->with(['synced', 'review', 'unknown']);
