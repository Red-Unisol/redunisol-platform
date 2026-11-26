<?php

use App\Jobs\RouteEdnaIntakeChat;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaBitrix;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaFreshIntake;
use App\Services\EdnaFreshCaseRoute;
use App\Services\WebChatContinuity;
use App\Services\EdnaIntakeBinding;
use App\Services\EdnaIntakeChatRouting;
use App\Services\EdnaMessageBinding;
use App\Services\EdnaNativeIntake;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicLoan;
use App\Services\EdnaPaidFlowGuard;
use App\Services\WebFormContinuation;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 17)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('n', 32)));
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'subject_id' => '2423',
        'api_key' => 'fixture', 'cascade_id' => '2557', 'router_start_at' => now()->subDay()->toIso8601String(),
        'router_recipients' => [], 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '950118281197789', 'intake_start_at' => now()->subDay()->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'fresh-test', 'intake_pilot_limit' => 'unlimited',
        'intake_processing_url' => 'https://example.test/bitrix24_whatsapp_intake/key']);
    DB::table('edna_intake_cutovers')->updateOrInsert(['name' => 'native-v3-v1'], ['entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    Queue::fake();
    Http::preventStrayRequests();
});

class FreshNativeCrm extends EdnaBitrix
{
    public bool $contact = false;

    public array $calls = [];

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = $method;
        $entity = $this->contact ? 'CONTACT' : 'LEAD';
        $code = 'whatsappbyedna|1|5493510000000@2423|901';
        $record = ['ID' => '101', 'ASSIGNED_BY_ID' => '57', 'CREATED_BY_ID' => '57',
            'PHONE' => [['VALUE' => '5493510000000']], 'STATUS_ID' => 'UC_PWTVG6', 'STATUS_SEMANTIC_ID' => 'P'];

        return match ($method) {
            'crm.duplicate.findbycomm' => [$payload['entity_type'] => $payload['entity_type'] === $entity ? ['101'] : []],
            'crm.lead.list', 'crm.contact.list' => [$record],
            'crm.lead.get', 'crm.contact.get' => $record,
            'imopenlines.crm.chat.get' => [['CHAT_ID' => '601', 'CONNECTOR_ID' => 'whatsappbyedna']],
            'crm.activity.list' => [['ID' => '801', 'OWNER_TYPE_ID' => $this->contact ? 3 : 1, 'OWNER_ID' => '101',
                'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => '501', 'PROVIDER_PARAMS' => ['USER_CODE' => $code]]],
            'imopenlines.dialog.get' => ['id' => '601', 'entity_type' => 'LINES', 'entity_id' => $code,
                'entity_data_1' => 'Y|'.$entity.'|101|N|N|501|123456|0|0|0',
                'entity_data_2' => 'LEAD|'.($this->contact ? '0' : '101').'|CONTACT|'.($this->contact ? '101' : '0').'|COMPANY|0|DEAL|0',
                'owner' => '74827', 'text_field_enabled' => true],
            'imopenlines.session.history.get' => ['sessionId' => '501', 'chatId' => '601', 'hasNextPage' => false,
                'users' => ['901' => ['connector' => true]], 'message' => ['701' => ['id' => '701', 'chatid' => '601',
                    'senderid' => '901', 'params' => ['connectorMid' => ['700001']]]]],
            default => throw new RuntimeException('Unexpected provider operation: '.$method),
        };
    }
}

function freshV3Fixture(bool $contact = false): array
{
    $payload = ['id' => '700001', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta del anuncio']];
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => '700001',
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);
    $entry = DB::table('edna_incoming_events')->find($id);
    $sendId = (new EdnaFlowRouter)->startPaidEntry($entry, $payload, ['version' => 1, 'route' => 'paid_direct_v3',
        'evidence' => ['kind' => 'provider_ad_referral', 'source_id' => 'fixture-ad']]);
    $crm = new FreshNativeCrm;
    $crm->contact = $contact;
    app()->instance(EdnaMessageBinding::class, new EdnaMessageBinding($crm));
    app()->instance(EdnaOrganicAttention::class, new EdnaOrganicAttention($crm));

    return [DB::table('edna_flow_sends')->find($sendId), $entry, $payload, $crm];
}

test('the real binding producer authorizes a new paid v3 send including its activity', function () {
    [$send] = freshV3Fixture();
    $proof = (new EdnaIntakeBinding)->resolve($send);
    expect($proof)->toMatchArray(['version' => 1, 'activity_id' => '801', 'lead_id' => '101'])
        ->and((new EdnaPaidFlowGuard)->context($send)['status'])->toBe('ready');
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->twice()->andReturn(['status' => 'ready', 'owner_id' => '74827', 'session_id' => '501']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    Http::fake(['app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE', 'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/cascade/schedule' => fn ($r) => Http::response(['requestId' => $r['requestId']])]);
    (new SendEdnaFlow($send->id))->handle();
    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('accepted');
});

test('a native contact can authorize paid intake without fabricating or reserving a lead', function () {
    [$send] = freshV3Fixture(true);
    $proof = (new EdnaIntakeBinding)->resolve($send);
    expect($proof)->toMatchArray(['version' => 2, 'contact_id' => '101', 'native_lead_id' => null, 'activity_id' => '801'])
        ->and(DB::table('edna_intake_bindings')->first()->lead_id)->toBeNull()
        ->and((new EdnaPaidFlowGuard)->context($send)['status'])->toBe('ready');
});

test('a completed existing case is not rebound as the original lead of a new inquiry', function () {
    [$send] = freshV3Fixture();
    DB::table('edna_intake_bindings')->insert(['flow_send_id' => 9999, 'case_id' => '11111111-1111-4111-8111-111111111111',
        'entry_event_id' => 9999, 'lead_id' => '101', 'state' => 'verified', 'created_at' => now()->subDay(), 'updated_at' => now()->subDay()]);
    $proof = (new EdnaIntakeBinding)->resolve($send);
    expect($proof['version'])->toBe(2)->and($proof['native_lead_id'])->toBe('101')
        ->and(DB::table('edna_intake_bindings')->where('flow_send_id', 9999)->first()->lead_id)->toBe('101');
});

test('deployment cutoff excludes old inbox entries and late old callbacks', function (string $kind) {
    [$send, $entry] = freshV3Fixture();
    if ($kind === 'old-inbox') {
        DB::table('edna_intake_cutovers')->update(['entry_id_after' => $entry->id]);
    } else {
        DB::table('edna_intake_cutovers')->update(['starts_at' => now()->addSecond()]);
    }
    expect((new EdnaFreshIntake)->applies($send))->toBeFalse();
    Http::assertNothingSent();
})->with(['old-inbox', 'late-callback']);

test('a receipt sharing a phone no longer intercepts a new entry without proof of continuation', function () {
    [$send, $entry, $payload] = freshV3Fixture();
    DB::table('web_form_receipts')->insert(['id' => '22222222-2222-4222-8222-222222222222',
        'reference_hash' => hash('sha256', 'unknown'), 'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
        'state' => 'synced', 'source' => 'web_server', 'received_at' => now(), 'expires_at' => now()->addDay(), 'created_at' => now(), 'updated_at' => now()]);
    expect((new WebFormContinuation)->receive($entry, $payload))->toBeNull()
        ->and(DB::table('web_form_continuations')->count())->toBe(0);
    $payload['messageContent']['text'] = '(solicitud: invalid)';
    expect((new WebFormContinuation)->receive($entry, $payload)['reason'])->toBe('web_form_reference_unverified');
});

function freshCompletedRequest(): array
{
    [$send] = freshV3Fixture(true);
    $proof = (new EdnaIntakeBinding)->resolve($send);
    $answer = ['provincia' => 'cordoba', 'situacion_cordoba' => 'empleado_publico', 'banco_cordoba' => 'bancor', 'cuil' => '20123456786'];
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'completed', 'response_event_id' => 88]);
    $id = DB::table('edna_intake_requests')->insertGetId(['flow_send_id' => $send->id, 'response_event_id' => 88,
        'state' => 'pending', 'answer' => Crypt::encryptString(json_encode($answer)), 'received_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

    return [DB::table('edna_intake_requests')->find($id), DB::table('edna_flow_sends')->find($send->id), $proof];
}

function independentCompletedFlow(): array
{
    [$request, $send, $proof] = freshCompletedRequest();
    DB::table('edna_intake_cutovers')->insert(['name' => EdnaFreshIntake::DECLARATION, 'starts_at' => now()->subMinute(), 'entry_id_after' => 0]);
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['outgoing_message_id' => '6200']);
    $payload = ['subjectId' => $send->subject_id, 'id' => '700099', 'subscriber' => ['identifier' => Crypt::decryptString($send->recipient)],
        'receivedAt' => now()->toIso8601String(), 'replyOutMessageId' => '6200', 'replyOutMessageExternalRequestId' => $send->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => Crypt::decryptString($request->answer)]];
    DB::table('edna_incoming_events')->insert(['id' => $request->response_event_id, 'subject_id' => $send->subject_id, 'message_id' => $payload['id'],
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);

    return [$request, DB::table('edna_flow_sends')->find($send->id), $proof];
}

test('a newly completed real v3 retains its Flow and tracks its own lead until the seller is known', function () {
    [$request, $send, $proof] = independentCompletedFlow();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->andReturn(['status' => 'ready']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    Http::fake(['example.test/*' => Http::response(['ok' => true, 'contract' => EdnaFreshIntake::DECLARATION,
        'case_id' => $send->request_id, 'action' => 'queued', 'reason' => 'ready',
        'write_attempted' => true, 'lead_id' => '909', 'contact_id' => ''])]);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['flow_id'] === $send->flow_id && $r['attribution']['wa']['WA_FLOW_ID'] === $send->flow_id
        && $r['response']['event_id'] === 88 && $r['response']['outgoing_message_id'] === '6200' && ! isset($r['provenance']));
    $route = DB::table('edna_intake_chat_routes')->where('request_id', $request->id)->sole();
    expect(json_decode($route->assigned_case, true))->toMatchArray(['lead_id' => '909', 'request_uuid' => $send->request_id])
        ->and(json_decode($route->proof, true)['session_id'])->toBe($proof['session_id']);
    Queue::assertPushed(RouteEdnaIntakeChat::class, 1);
});

test('a historical owner is protected unless native CRM reassignment is disabled', function () {
    $case = ['lead_id' => '501'];
    $record = ['entity' => 'lead', 'id' => '101', 'owner' => '901', 'creator' => '901'];
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->twice()->with('imopenlines.config.get', ['CONFIG_ID' => 1])
        ->andReturn(['ID' => '1', 'CRM_TRANSFER_CHANGE' => 'Y'], ['ID' => '1', 'CRM_TRANSFER_CHANGE' => 'N']);
    $route = new EdnaFreshCaseRoute;
    expect($route->protectsHistoricalOwners(['records' => [$record]], $case, 123, $crm))->toBeFalse()
        ->and($route->protectsHistoricalOwners(['records' => [$record]], $case, 123, $crm))->toBeTrue()
        ->and($route->protectsHistoricalOwners(['records' => [$record, [...$record, 'id' => '501']]], $case, 123, $crm))->toBeFalse()
        ->and($route->protectsHistoricalOwners(['records' => [[...$record, 'id' => '501', 'owner' => '71283', 'creator' => '71283']]], $case, 123, $crm))->toBeTrue();
});

test('a verified web reference and new declaration share a request only in the same session and for the same CUIL', function (bool $matching) {
    [$request, $send, $proof] = independentCompletedFlow();
    DB::table('edna_intake_cutovers')->updateOrInsert(['name' => WebChatContinuity::NAME], ['starts_at' => now()->subMinute(), 'entry_id_after' => 0]);
    $token = str_repeat('a', 32);
    $uuid = 'eeeeeeee-2222-4222-8222-222222222222';
    $hash = (new AttributionJourney)->phoneHash('5493510000000');
    DB::table('web_form_receipts')->insert(['id' => $uuid, 'source' => 'web_server', 'phone_hash' => $hash,
        'reference_hash' => hash('sha256', $token), 'identity_hash' => (new WebFormReceipt)->identityHash($matching ? '20123456786' : '20999999999'),
        'state' => 'synced', 'lead_id' => '707', 'contact_id' => '708', 'received_at' => now()->subSeconds(3), 'expires_at' => now()->addDay(),
        'persisted_at' => now(), 'created_at' => now()->subSeconds(3), 'updated_at' => now()]);
    $payload = ['subjectId' => '2423', 'id' => '880001', 'receivedAt' => now()->toIso8601String(), 'subscriber' => ['identifier' => '5493510000000'],
        'messageContent' => ['type' => 'TEXT', 'text' => "(solicitud: $token)"]];
    $anchorId = DB::table('edna_incoming_events')->insertGetId(['subject_id' => $send->subject_id, 'message_id' => '880001',
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);
    $anchor = DB::table('edna_incoming_events')->find($anchorId);
    $id = (new WebChatContinuity)->captureReference($anchor, DB::table('web_form_receipts')->find($uuid));
    $anchorProof = [...$proof, 'entry_event_id' => $anchorId, 'entry_message_id' => '880001', 'message_id' => '852'];
    DB::table('web_chat_contexts')->where('id', $id)->update(['chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'],
        'proof' => json_encode($anchorProof), 'state' => 'bound']);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->andReturn(['status' => 'ready']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    Http::fake(['example.test/*' => Http::response(['ok' => true, 'contract' => EdnaFreshIntake::DECLARATION,
        'case_id' => $send->request_id, 'action' => 'queued', 'reason' => 'ready', 'write_attempted' => true, 'lead_id' => '909'])]);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    $stored = DB::table('edna_intake_requests')->find($request->id);
    if ($matching) {
        expect($stored)->toMatchObject(['state' => 'pending_requalification', 'web_submission_id' => $uuid, 'lead_id' => '707']);
        Http::assertNothingSent();
        Queue::assertPushed(\App\Jobs\RequalifyEdnaWebDeclaration::class, 1);
    } else {
        expect($stored->state)->toBe('synced')->and($stored->web_submission_id)->toBeNull()->and($stored->lead_id)->toBe('909');
        Http::assertSentCount(1);
    }
})->with([true, false]);

test('a later authenticated inbound in the original session extends the valid handoff time', function () {
    [$request, $send, $proof] = independentCompletedFlow();
    $this->travel(25)->hours();
    $payload = ['id' => '700150', 'subjectId' => $send->subject_id, 'receivedAt' => now()->subMinutes(5)->toIso8601String(),
        'subscriber' => ['identifier' => Crypt::decryptString($send->recipient)], 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta']];
    DB::table('edna_incoming_events')->insert(['subject_id' => $send->subject_id, 'message_id' => $payload['id'],
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->once()->with('imopenlines.session.history.get', ['SESSION_ID' => (int) $proof['session_id']])
        ->andReturn(['sessionId' => $proof['session_id'], 'chatId' => $proof['chat_id'], 'hasNextPage' => false,
            'users' => ['900' => ['connector' => true]], 'message' => [['senderid' => '900', 'chatid' => $proof['chat_id'],
                'params' => ['connectorMid' => [$payload['id']]]]]]);
    expect((new EdnaFreshCaseRoute)->expiresAt($send, $request, $proof, $crm)->toIso8601String())
        ->toBe(now()->subMinutes(5)->addDay()->toIso8601String());
});

test('the exact new lead hands its session to its assigned seller once, preserving a human takeover and foreign CRM owners', function (string $scenario) {
    [$request, $send, $proof] = independentCompletedFlow();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'synced', 'lead_id' => '909']);
    $case = ['lead_id' => '909', 'request_uuid' => $send->request_id, 'identity_hash' => (new WebFormReceipt)->identityHash('20123456786')];
    DB::table('edna_intake_chat_routes')->insert(['request_id' => $request->id, 'proof' => json_encode($proof),
        'assigned_case' => json_encode($case), 'state' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
    $allowed = Mockery::mock(\App\Support\BitrixSellerRegistry::class);
    $allowed->shouldReceive('enabledIds')->andReturn([5737]);
    app()->instance(\App\Support\BitrixSellerRegistry::class, $allowed);
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->with('crm.lead.get', ['id' => '909'])->andReturn(['ID' => '909', 'UF_CRM_1693840106704' => '20123456786',
        'ORIGINATOR_ID' => 'redunisol.edna.fresh-v3', 'ORIGIN_ID' => $send->request_id, 'UF_CRM_WA_ASSISTANCE_ID' => $send->request_id,
        'STATUS_SEMANTIC_ID' => 'S', 'CONTACT_ID' => '0']);
    $crm->shouldReceive('call')->withArgs(fn ($m, $p) => $m === 'crm.deal.list' && $p['filter']['=LEAD_ID'] === '909')
        ->andReturn([['ID' => '800', 'LEAD_ID' => '909', 'CATEGORY_ID' => '1', 'STAGE_ID' => 'C1:NEW',
            'STAGE_SEMANTIC_ID' => 'P', 'CLOSED' => 'N', 'ASSIGNED_BY_ID' => '5737', 'CONTACT_ID' => '0']]);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('targetActive')->once()->with(5737)->andReturn(true);
    $attention->shouldReceive('canTransfer')->once()->andReturn(true);
    $snapshot = ['dialog_tuple' => ['owner' => '74827'], 'records' => [['entity' => 'lead', 'id' => '101', 'owner' => '42', 'creator' => '42']]];
    $ready = ['status' => 'ready', 'owner_id' => '74827', 'native_snapshot' => $snapshot];
    $attention->shouldReceive('inspect')->twice()->andReturn($ready, $scenario === 'manual'
        ? ['status' => 'preserved', 'reason' => 'operator_attention_preserved'] : $ready);
    if ($scenario !== 'manual') {
        $attention->shouldReceive('compatible')->andReturn(true);
        $crm->shouldReceive('call')->once()->with('imopenlines.config.get', ['CONFIG_ID' => 1])->andReturn(['ID' => 1,
            'CRM_TRANSFER_CHANGE' => $scenario === 'safe' ? 'N' : 'Y']);
    }
    app()->instance(EdnaBitrix::class, $crm);
    app()->instance(EdnaOrganicAttention::class, $attention);
    if ($scenario === 'safe') {
        $crm->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => (int) $proof['chat_id'], 'USER_ID' => 5737])->andReturn(true);
        $attention->shouldReceive('snapshot')->once()->andReturn(['dialog_tuple' => ['owner' => '5737']]);
        expect(fn () => (new EdnaIntakeChatRouting)->route($request->id))->toThrow(RuntimeException::class);
    }
    (new EdnaIntakeChatRouting)->route($request->id);
    (new EdnaIntakeChatRouting)->route($request->id);
    $reason = DB::table('edna_intake_chat_routes')->where('request_id', $request->id)->value('reason');
    expect($reason)->toBe(match ($scenario) {
        'safe' => 'target_confirmed', 'manual' => 'operator_attention_preserved', 'foreign' => 'native_crm_transfer_would_change_owner',
    });
})->with(['safe', 'manual', 'foreign']);

test('fresh completed v3 reuses the existing identity contract and enqueues its assigned chat once', function () {
    [$request, $send, $proof] = freshCompletedRequest();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->andReturn(['status' => 'ready']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    Http::fake(['example.test/*' => Http::response(['ok' => true, 'contract' => EdnaOrganicLoan::CONTRACT,
        'case_id' => $send->request_id, 'action' => 'assigned_case', 'reason' => 'existing_assigned_case',
        'write_attempted' => false, 'lead_id' => '', 'contact_id' => '101', 'deal_id' => '301', 'seller_id' => '5737'])]);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    $again = DB::table('edna_intake_requests')->find($request->id);
    (new EdnaNativeIntake)->process($again, $send, $proof);
    expect($again->state)->toBe('synced')->and(DB::table('edna_intake_chat_routes')->count())->toBe(1);
    Queue::assertPushed(RouteEdnaIntakeChat::class, 1);
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r['crm_binding']['version'] === 1 && $r['crm_binding']['activity_id'] === '801'
        && $r['provenance']['source_id'] === (string) $request->id && ! isset($r['flow_id']));
});

test('the contact deal proof is enabled by the original entry and retained for the queued transfer', function (bool $old) {
    [$request, $send, $proof] = freshCompletedRequest();
    foreach ([WebChatContinuity::NAME, EdnaFreshIntake::CONTACT_DEAL] as $name) {
        DB::table('edna_intake_cutovers')->updateOrInsert(['name' => $name], [
            'entry_id_after' => $old && $name === EdnaFreshIntake::CONTACT_DEAL ? $send->entry_event_id : 0,
            'starts_at' => now()->subHour(),
        ]);
    }
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->andReturn(['status' => 'ready']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    Http::fake(['example.test/*' => function ($r) use ($send, $old) {
        expect($r['contact_deal_activity'] ?? false)->toBe(! $old);

        return Http::response(['ok' => true, 'contract' => EdnaOrganicLoan::CONTRACT,
            'case_id' => $send->request_id, 'action' => $old ? 'manual_review' : 'assigned_case',
            'reason' => $old ? 'native_activity_unverified' : 'existing_contact_deal',
            'contact_deal_stage' => $old ? '' : 'C1:NEW', 'write_attempted' => false,
            'lead_id' => '', 'contact_id' => '101', 'deal_id' => '301', 'seller_id' => '5737']);
    }]);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    Http::assertSentCount(1);
    $receipt = DB::table('edna_intake_chat_routes')->where('request_id', $request->id)->first();
    if ($old) {
        expect($receipt)->toBeNull();
    } else {
        expect(json_decode($receipt->assigned_case, true)['contact_deal_stage'])->toBe('C1:NEW');
    }
})->with([true, false]);

test('human attention preserves a completed new intake without a CRM application post', function () {
    [$request, $send, $proof] = freshCompletedRequest();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->once()->andReturn(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    expect(DB::table('edna_intake_requests')->find($request->id)->reason)->toBe('operator_attention_preserved');
    Http::assertNothingSent();
});

class FreshRouteCrm extends EdnaBitrix
{
    public int $transfers = 0;

    public bool $uncertain = false;

    public bool $changedSeller = false;

    public function call(string $method, array $payload = []): mixed
    {
        if ($method === 'imopenlines.operator.transfer') {
            $this->transfers++;
            if ($this->uncertain) {
                throw new RuntimeException('Transport result uncertain.');
            }

            return true;
        }

        return match ($method) {
            'crm.deal.get' => ['ID' => '301', 'CONTACT_ID' => '101', 'LEAD_ID' => '0', 'CATEGORY_ID' => '1',
                'ASSIGNED_BY_ID' => $this->changedSeller ? '999' : '5737', 'STAGE_ID' => 'ACTIVE', 'STAGE_SEMANTIC_ID' => 'P'],
            'crm.contact.get' => ['ID' => '101', 'UF_CRM_65B7E48033FCD' => '20123456786'],
            default => throw new RuntimeException('Unexpected routing operation.'),
        };
    }
}

function freshRouteFixture(): array
{
    [$request, $send, $proof] = freshCompletedRequest();
    DB::table('edna_intake_requests')->where('id', $request->id)->update(['state' => 'synced']);
    $case = ['lead_id' => '', 'contact_id' => '101', 'deal_id' => '301', 'seller_id' => '5737',
        'identity_hash' => (new WebFormReceipt)->identityHash('20123456786')];
    DB::table('edna_intake_chat_routes')->insert(['request_id' => $request->id, 'state' => 'pending',
        'proof' => json_encode($proof), 'assigned_case' => json_encode($case), 'created_at' => now(), 'updated_at' => now()]);
    $crm = new FreshRouteCrm;
    app()->instance(EdnaBitrix::class, $crm);

    return [$request, $proof, $crm];
}

test('human taking the chat at the final check prevents the new native transfer', function () {
    [$request, $proof, $crm] = freshRouteFixture();
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('targetActive')->once()->with(5737)->andReturn(true);
    $attention->shouldReceive('canTransfer')->once()->andReturn(true);
    $attention->shouldReceive('inspect')->twice()->andReturn(
        ['status' => 'ready', 'owner_id' => '74827', 'native_snapshot' => ['before' => true]],
        ['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
    app()->instance(EdnaOrganicAttention::class, $attention);
    (new EdnaIntakeChatRouting)->route($request->id);
    expect($crm->transfers)->toBe(0)
        ->and(DB::table('edna_intake_chat_routes')->first()->reason)->toBe('operator_attention_preserved');
});

test('a native transfer is posted once and uncertain retries only reconcile', function (bool $uncertain) {
    [$request, $proof, $crm] = freshRouteFixture();
    $crm->uncertain = $uncertain;
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('targetActive')->once()->andReturn(true);
    $attention->shouldReceive('canTransfer')->once()->andReturn(true);
    $attention->shouldReceive('inspect')->twice()->andReturn(['status' => 'ready', 'owner_id' => '74827', 'native_snapshot' => ['before' => true]]);
    $attention->shouldReceive('compatible')->twice()->andReturn(true);
    $attention->shouldReceive('snapshot')->once()->andReturn(['dialog_tuple' => ['owner' => '5737']]);
    app()->instance(EdnaOrganicAttention::class, $attention);
    expect(fn () => (new EdnaIntakeChatRouting)->route($request->id))->toThrow(RuntimeException::class);
    (new EdnaIntakeChatRouting)->route($request->id);
    (new EdnaIntakeChatRouting)->route($request->id);
    expect($crm->transfers)->toBe(1)->and(DB::table('edna_intake_chat_routes')->first()->state)->toBe($uncertain ? 'observed' : 'confirmed');
})->with([true, false]);

test('changed commercial ownership prevents routing to the previous seller', function () {
    [$request, $proof, $crm] = freshRouteFixture();
    $crm->changedSeller = true;
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('targetActive')->once()->andReturn(true);
    app()->instance(EdnaOrganicAttention::class, $attention);
    (new EdnaIntakeChatRouting)->route($request->id);
    expect($crm->transfers)->toBe(0)
        ->and(DB::table('edna_intake_chat_routes')->first()->reason)->toBe('commercial_assignment_changed');
});

test('an old completed intake stays untouched even if its worker is called again', function () {
    [$request, $send, $proof] = freshCompletedRequest();
    DB::table('edna_intake_cutovers')->update(['entry_id_after' => $send->entry_event_id]);
    (new EdnaNativeIntake)->process($request, $send, $proof);
    expect(DB::table('edna_intake_requests')->find($request->id)->state)->toBe('pending')
        ->and(DB::table('edna_intake_chat_routes')->count())->toBe(0);
    Http::assertNothingSent();
});

test('cutover activation is idempotent and never moves its old-entry boundary', function () {
    DB::table('edna_intake_cutovers')->delete();
    [$send, $entry] = freshV3Fixture();
    $this->artisan('edna:intake-cutover activate')->assertSuccessful();
    $cut = DB::table('edna_intake_cutovers')->first();
    expect((int) $cut->entry_id_after)->toBe((int) $entry->id)
        ->and((new EdnaFreshIntake)->applies($send))->toBeFalse();
    $this->travel(1)->minutes();
    $this->artisan('edna:intake-cutover activate')->assertSuccessful();
    expect(DB::table('edna_intake_cutovers')->first())->toEqual($cut);
    Queue::assertNotPushed(RouteEdnaIntakeChat::class);
});
