<?php

use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Services\AttributionJourney;
use App\Services\EdnaBenefitsRouting;
use App\Services\EdnaBitrix;
use App\Services\EdnaIntake;
use App\Services\EdnaMessageBinding;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicLoan;
use App\Services\EdnaOrganicMenu;
use App\Services\EdnaOrganicTransport;
use App\Services\WebChatContinuity;
use App\Services\WebFormChatRouting;
use App\Services\WebFormReceipt;
use Illuminate\Queue\Events\JobQueued;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    fakeSalesTransferWindow();
    $this->travelTo(now()->setDate(2026, 11, 11)->setTime(15, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('m', 32)));
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'intake_enabled' => true,
        'intake_crm_enabled' => true, 'organic_menu_enabled' => true, 'subject_id' => '2423', 'cascade_id' => '2557',
        'organic_menu_start_at' => now()->subDay()->toIso8601String(), 'organic_other_operator_id' => 5737,
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'router_recipients' => [], 'intake_recipients' => []]);
    Queue::fake();
    Http::preventStrayRequests();
});

function organicMenuEvent(array $changes = []): object
{
    $message = (string) (930000 + DB::table('edna_incoming_events')->count());
    $payload = array_replace_recursive(['id' => $message, 'subjectId' => '2423',
        'subscriber' => ['identifier' => '5493510000000'], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola']], $changes);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)), 'status' => 'delivered',
        'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_incoming_events')->find($id);
}

function organicMenuPayload(object $event): array
{
    return json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
}

function organicMenuProof(object $event, int $session = 501): array
{
    return ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => $event->id, 'entry_message_id' => $event->message_id, 'chat_id' => '601',
        'session_id' => (string) $session, 'activity_id' => '801', 'message_id' => (string) (700 + $event->id), 'native_lead_id' => '101'];
}

function organicMenuHarness(?Closure $resolve = null): array
{
    $crm = Mockery::mock(EdnaBitrix::class);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolveCurrent')->andReturnUsing($resolve ?? fn ($event) => organicMenuProof($event));
    $transport = Mockery::mock(EdnaOrganicTransport::class);
    $transport->shouldReceive('assertChannel')->byDefault()->andReturnNull();
    $transport->shouldReceive('schedule')->byDefault()->andReturn(['send_state' => 'accepted', 'send_reason' => null, 'accepted_at' => now()]);
    $transport->shouldReceive('reconcile')->byDefault()->andReturn(['send_state' => 'confirmed', 'send_reason' => null,
        'outgoing_message_id' => '901', 'confirmed_at' => now()]);
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('inspectWelcome')->byDefault()->andReturn(['status' => 'ready', 'owner_id' => '0', 'session_id' => '501']);
    $snapshot = ['version' => 1, 'dialog_tuple' => ['chat_id' => '601', 'session_id' => '501', 'owner' => '0'],
        'records' => [], 'fingerprint' => str_repeat('a', 64)];
    $attention->shouldReceive('inspect')->byDefault()->andReturn(['status' => 'ready', 'owner_id' => '0',
        'session_id' => '501', 'native_snapshot' => $snapshot]);
    $attention->shouldReceive('targetActive')->byDefault()->andReturnTrue();
    $attention->shouldReceive('canTransfer')->byDefault()->andReturnTrue();
    $attention->shouldReceive('compatible')->byDefault()->andReturnTrue();
    $attention->shouldReceive('snapshot')->byDefault()->andReturn($snapshot);
    $service = new EdnaOrganicMenu($crm, $binding, $transport, $attention);

    return compact('service', 'crm', 'binding', 'transport', 'attention');
}

function organicMenuCapture(EdnaOrganicMenu $service, ?object $event = null): object
{
    $event ??= organicMenuEvent();
    expect($service->receiveEntry($event, organicMenuPayload($event)))->toBeTrue();

    return DB::table('edna_organic_menus')->where('entry_event_id', $event->id)->first();
}

function organicMenuDue(int $id, array $changes = []): object
{
    DB::table('edna_organic_menus')->where('id', $id)->update($changes + ['available_at' => now(), 'enqueued_at' => null]);

    return DB::table('edna_organic_menus')->find($id);
}

function organicMenuChoice(object $menu, string $choice = 'loan', array $changes = []): object
{
    return organicMenuEvent(array_replace_recursive([
        'messageContent' => ['type' => 'LIST_PICKER', 'text' => 'elección',
            'payload' => EdnaOrganicTransport::payload($menu->request_id, $choice)],
        'replyOutMessageExternalRequestId' => $menu->request_id, 'replyOutMessageId' => '901',
    ], $changes));
}

function organicMenuConfirmed(array $harness): object
{
    $menu = organicMenuCapture($harness['service']);
    $harness['service']->process($menu->id);
    organicMenuDue($menu->id);
    $harness['service']->process($menu->id);

    // These direct handler calls stand in for completed workers, including ACK.
    DB::table('jobs')->whereIn('id', DB::table('edna_work_queue_keys')
        ->where('job_class', ProcessEdnaOrganicMenu::class)->where('work_id', $menu->id)->select('queue_job_id'))->delete();

    return DB::table('edna_organic_menus')->find($menu->id);
}

function organicMenuAssignedCase(array $harness, string $leadId = '310'): object
{
    $menu = organicMenuConfirmed($harness);
    $choice = organicMenuChoice($menu);
    $harness['service']->receiveChoice($choice, organicMenuPayload($choice));
    $proof = json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR);
    $proof['choice_proof'] = organicMenuProof($choice);

    return organicMenuDue($menu->id, [
        'state' => 'route_pending', 'seller_id' => '29', 'deal_id' => '110',
        'proof' => json_encode($proof, JSON_THROW_ON_ERROR),
        'profile_snapshot' => Crypt::encryptString(json_encode(['cuil' => '20301234563'], JSON_THROW_ON_ERROR)),
        'profile_evidence' => json_encode(['assigned_case' => ['deal_id' => '110', 'seller_id' => '29',
            'contact_id' => '210', 'lead_id' => $leadId,
            'profile_identity_hash' => (new WebFormReceipt)->identityHash('20301234563')]], JSON_THROW_ON_ERROR),
    ]);
}

function organicMenuAssignedDeal(string $leadId = '310', string $contactId = '210'): array
{
    return ['ID' => '110', 'ASSIGNED_BY_ID' => '29', 'LEAD_ID' => $leadId === '' ? 0 : $leadId,
        'CONTACT_ID' => $contactId, 'CATEGORY_ID' => '1', 'STAGE_ID' => 'C1:IN_WORK', 'STAGE_SEMANTIC_ID' => 'P'];
}

test('organic capture is local atomic and does not reserve a loan admission before a choice', function (string $type) {
    $h = organicMenuHarness();
    $event = organicMenuEvent(['messageContent' => ['type' => $type]]);
    $menu = organicMenuCapture($h['service'], $event);
    $h['service']->receiveEntry($event, organicMenuPayload($event));

    expect(DB::table('edna_organic_menus')->count())->toBe(1)
        ->and($menu->send_state)->toBe('pending')
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertPushed(ProcessEdnaOrganicMenu::class, 1);
    Http::assertNothingSent();
    $h['transport']->shouldNotHaveReceived('schedule');
})->with(['TEXT', 'BUTTON']);

test('unknown organic tokens and replies are consumed without creating a second menu', function () {
    $h = organicMenuHarness();
    $event = organicMenuEvent(['messageContent' => ['payload' => 'organic:'.Str::uuid().':loan']]);

    expect($h['service']->receiveChoice($event, organicMenuPayload($event)))->toBeTrue()
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($event->id)->router_action)->toBe('organic_choice_unmatched');
    Queue::assertNothingPushed();
});

test('a menu send is claimed once and uncertain acknowledgement only reads history', function () {
    $h = organicMenuHarness();
    $h['transport']->shouldReceive('schedule')->once()->andReturn(['send_state' => 'unknown', 'send_reason' => 'uncertain']);
    $h['transport']->shouldReceive('reconcile')->twice()->andReturn(['send_state' => 'unknown', 'send_reason' => 'unconfirmed']);
    $menu = organicMenuCapture($h['service']);
    $h['service']->process($menu->id);
    for ($i = 0; $i < 2; $i++) {
        organicMenuDue($menu->id);
        $h['service']->process($menu->id);
    }

    expect(DB::table('edna_organic_menus')->find($menu->id)->send_state)->toBe('unknown')
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
});

test('a callback before outgoing history confirmation is saved and schedules loan preparation only after proof', function (string $type) {
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    $h['service']->process($menu->id);
    $menu = DB::table('edna_organic_menus')->find($menu->id);
    $choice = organicMenuChoice($menu, 'loan', ['messageContent' => ['type' => $type]]);
    expect($h['service']->receiveChoice($choice, organicMenuPayload($choice)))->toBeTrue();
    $h['service']->process($menu->id);
    Queue::assertNotPushed(PrepareEdnaOrganicLoan::class);
    organicMenuDue($menu->id);
    $h['service']->process($menu->id);

    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('loan_pending')
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertPushed(PrepareEdnaOrganicLoan::class, 1);
    expect($h['service']->process($menu->id)['state'])->toBe('not_claimed');
})->with(['LIST_PICKER', 'BUTTON']);

test('the native session flow prevents a second welcome and an explicit contact inquiry has its own loan intent', function (bool $existing) {
    config(['edna.sales_inbox_enabled' => true]);
    $h = organicMenuHarness();
    $entry = organicMenuEvent(['messageContent' => ['text' => 'Quiero solicitar un préstamo']]);
    $menu = organicMenuCapture($h['service'], $entry);
    $flow = Mockery::mock(\App\Services\SalesSessionFlow::class);
    $flow->shouldReceive('find')->andReturn($existing ? (object)['id' => 88] : null);
    $flow->shouldReceive('hasRecentActive')->andReturnFalse();
    app()->instance(\App\Services\SalesSessionFlow::class, $flow);
    $campaign = Mockery::mock(\App\Services\SalesCampaignReply::class);
    $existing ? $campaign->shouldNotReceive('reserve') : $campaign->shouldReceive('reserve')->once()->andReturn(['loan_contact' => '800']);
    app()->instance(\App\Services\SalesCampaignReply::class, $campaign);
    $h['transport']->shouldNotReceive('schedule');
    $h['service']->process($menu->id);
    $h['service']->process($menu->id);
    $row = DB::table('edna_organic_menus')->find($menu->id);
    expect($row->state)->toBe($existing ? 'preserved' : 'loan_pending')->and($row->outgoing_message_id)->toBeNull();
    if ($existing) {
        expect($row->reason)->toBe('same_session_v3_preserved')->and($row->choice_event_id)->toBeNull();
        Queue::assertNotPushed(PrepareEdnaOrganicLoan::class);
    } else {
        expect($row->send_state)->toBe('not_needed')->and(\App\Services\SalesLoanIntent::verified($row))->toBeTrue();
        Queue::assertPushed(PrepareEdnaOrganicLoan::class, 1);
    }
})->with([[true], [false]]);

test('another explicit entry in the same campaign session can renew its reservation without ever duplicating the menu', function () {
    config(['edna.sales_inbox_enabled' => true]);
    $h = organicMenuHarness();
    $entry = organicMenuEvent(['messageContent' => ['text' => 'Quiero solicitar un préstamo']]);
    $prior = organicMenuCapture($h['service'], $entry);
    organicMenuDue($prior->id, ['chat_id' => '601', 'session_id' => '501', 'state' => 'preserved', 'reason' => 'commercial_continuation_reserved']);
    $next = organicMenuEvent(['messageContent' => ['text' => 'Quiero solicitar un préstamo']]);
    $second = organicMenuCapture($h['service'], $next);
    $campaign = Mockery::mock(\App\Services\SalesCampaignReply::class);
    $campaign->shouldReceive('reserve')->once()->with(organicMenuPayload($next), organicMenuProof($next), true)->andReturnTrue();
    app()->instance(\App\Services\SalesCampaignReply::class, $campaign);
    $h['transport']->shouldNotReceive('schedule');
    $h['service']->process($second->id);
    $row = DB::table('edna_organic_menus')->find($second->id);
    expect($row->state)->toBe('preserved')->and($row->reason)->toBe('commercial_continuation_reserved')
        ->and((int) $row->canonical_menu_id)->toBe((int) $prior->id)->and($row->send_started_at)->toBeNull();
});

test('duplicate and contrary callbacks cannot change the first choice or schedule another case', function () {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $first = organicMenuChoice($menu, 'loan');
    $second = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($first, organicMenuPayload($first));
    $h['service']->receiveChoice($first, organicMenuPayload($first));
    $h['service']->receiveChoice($second, organicMenuPayload($second));
    $saved = DB::table('edna_organic_menus')->find($menu->id);

    expect($saved->choice)->toBe('loan')->and((int) $saved->choice_event_id)->toBe((int) $first->id)
        ->and(DB::table('edna_incoming_events')->find($second->id)->router_action)->toBe('organic_choice_unmatched');
    Queue::assertPushed(ProcessEdnaOrganicMenu::class, 2);
});

test('a choice from another phone or outgoing reference never claims a menu', function (array $changes) {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'loan', $changes);

    expect($h['service']->receiveChoice($choice, organicMenuPayload($choice)))->toBeTrue()
        ->and(DB::table('edna_organic_menus')->find($menu->id)->choice_event_id)->toBeNull();
})->with([
    [['subscriber' => ['identifier' => '5493519999999']]],
    [['replyOutMessageId' => '999']],
    [['replyOutMessageExternalRequestId' => '94dcc4b7-116f-4965-bc63-05ce6fa62c50']],
]);

test('the callback native message must belong to the same chat session before loan preparation', function () {
    $h = organicMenuHarness(fn ($event) => organicMenuProof($event, (int) $event->id === 1 ? 501 : 999));
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu);
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));

    expect($h['service']->process($menu->id)['state'])->toBe('preserved')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->reason)->toBe('choice_native_session_changed');
    Queue::assertNotPushed(PrepareEdnaOrganicLoan::class);
});

test('human attention suppresses the welcome without touching CRM or admissions', function (string $type) {
    $h = organicMenuHarness();
    $h['attention']->shouldReceive('inspectWelcome')->once()->andReturn(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
    $menu = organicMenuCapture($h['service'], organicMenuEvent(['messageContent' => ['type' => $type]]));

    expect($h['service']->process($menu->id)['state'])->toBe('preserved')
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    $h['transport']->shouldNotHaveReceived('schedule');
    $h['crm']->shouldNotHaveReceived('call');
})->with(['TEXT', 'BUTTON']);

test('human acceptance after the welcome preserves the chat before loan preparation', function () {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu);
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    $h['attention']->shouldReceive('inspectWelcome')->once()
        ->andReturn(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);

    expect($h['service']->process($menu->id)['state'])->toBe('preserved')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(PrepareEdnaOrganicLoan::class);
});

test('a welcome is unique per exact chat session and a new session gets its own menu', function (bool $sameSession) {
    $h = organicMenuHarness(fn ($event) => organicMenuProof($event, (int) $event->id === 1 || $sameSession ? 501 : 502));
    $first = organicMenuCapture($h['service']);
    $h['service']->process($first->id);
    $second = organicMenuCapture($h['service']);
    $h['service']->process($second->id);
    $saved = DB::table('edna_organic_menus')->find($second->id);

    expect($saved->state)->toBe($sameSession ? 'duplicate' : 'waiting')
        ->and($saved->canonical_menu_id)->toBe($sameSession ? $first->id : null);
    $h['transport']->shouldHaveReceived('schedule')->times($sameSession ? 1 : 2);
    expect(DB::table('edna_intake_admissions')->count())->toBe(0);
})->with([true, false]);

test('an other choice transfers once and lost acknowledgement can only become observed', function (bool $ack) {
    $h = organicMenuHarness();
    $h['attention']->shouldReceive('canTransfer')->once()->with(Mockery::type('array'), 5737, true, null)->andReturnTrue();
    $h['attention']->shouldReceive('compatible')->once()->with(Mockery::type('array'), Mockery::type('array'), 5737, false, true, null)->andReturnTrue();
    $h['attention']->shouldReceive('compatible')->once()->with(Mockery::type('array'), Mockery::type('array'), 5737, true, true, null)->andReturnTrue();
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => 601, 'USER_ID' => 5737])->andReturn($ack);
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.dialog.get', ['CHAT_ID' => 601])
        ->andReturn(['id' => 601, 'owner' => 5737, 'entity_data_1' => 'Y|LEAD|101|N|N|501|1794400000', 'text_field_enabled' => true]);
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    expect($h['service']->process($menu->id)['state'])->toBe('unknown');
    expect(json_decode(DB::table('edna_organic_menus')->find($menu->id)->transfer_intent, true)['routing_policy'])->toBe('other_inquiry');
    organicMenuDue($menu->id);
    expect($h['service']->process($menu->id)['state'])->toBe('routed')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->transfer_state)->toBe($ack ? 'confirmed' : 'observed');
    expect($h['service']->process($menu->id)['state'])->toBe('not_claimed');
})->with([true, false]);

test('acceptance immediately before an other inquiry transfer preserves the human attention', function () {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    $h['attention']->shouldReceive('inspect')->twice()->andReturn(
        ['status' => 'ready', 'owner_id' => '0', 'session_id' => '501', 'native_snapshot' => ['version' => 1]],
        ['status' => 'preserved', 'reason' => 'operator_attention_preserved'],
    );
    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'operator_attention_preserved']);
    $h['crm']->shouldNotHaveReceived('call');
});

test('an uncertain transfer never posts again when its result is absent', function () {
    $h = organicMenuHarness();
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => 601, 'USER_ID' => 5737])
        ->andThrow(new RuntimeException('timeout after send'));
    $h['crm']->shouldReceive('call')->twice()->with('imopenlines.dialog.get', ['CHAT_ID' => 601])
        ->andReturn(['id' => 601, 'owner' => 0, 'entity_data_1' => 'Y|LEAD|101|N|N|501|1794400000', 'text_field_enabled' => true]);
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    $h['service']->process($menu->id);
    for ($i = 0; $i < 2; $i++) {
        organicMenuDue($menu->id);
        expect($h['service']->process($menu->id)['state'])->toBe('unknown');
    }
    expect(DB::table('edna_organic_menus')->find($menu->id)->transfer_state)->toBe('unknown');
});

test('a closed or replaced session after an uncertain transfer is preserved without reopening', function (bool $closed) {
    $h = organicMenuHarness();
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => 601, 'USER_ID' => 5737])->andReturnFalse();
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.dialog.get', ['CHAT_ID' => 601])
        ->andReturn(['id' => 601, 'owner' => 5737, 'entity_data_1' => 'Y|LEAD|101|N|N|'.($closed ? '501' : '999').'|1794400000',
            'text_field_enabled' => ! $closed]);
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    $h['service']->process($menu->id);
    organicMenuDue($menu->id);

    expect($h['service']->process($menu->id)['state'])->toBe('preserved')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->transfer_state)->toBe('unknown');
})->with([true, false]);

test('changed CRM snapshots preserve ownership before the transfer POST', function () {
    $h = organicMenuHarness();
    $h['attention']->shouldReceive('compatible')->once()->andReturnFalse();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));

    expect($h['service']->process($menu->id)['state'])->toBe('preserved');
    $h['crm']->shouldNotHaveReceived('call');
});

test('the shared bridge lock and an active row lease defer without provider writes', function () {
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    organicMenuDue($menu->id, ['lease_until' => now()->addMinute(), 'lease_token' => (string) Str::uuid()]);
    expect($h['service']->process($menu->id)['state'])->toBe('not_claimed');
    organicMenuDue($menu->id, ['lease_until' => null, 'lease_token' => null]);
    $lock = Cache::lock('web-form-chat:601', 120, 'another-owner');
    expect($lock->get())->toBeTrue()
        ->and($h['service']->process($menu->id)['reason'])->toBe('chat_routing_in_progress');
    $lock->release();
    organicMenuDue($menu->id);
    expect($h['service']->process($menu->id)['state'])->toBe('waiting');
    $h['transport']->shouldHaveReceived('schedule')->once();
});

test('binding recovery is bounded and the menu poll excludes loan owned states', function () {
    $h = organicMenuHarness(fn () => null);
    $menu = organicMenuCapture($h['service']);
    organicMenuDue($menu->id, ['attempts' => 11]);
    expect($h['service']->process($menu->id)['state'])->toBe('review');
    organicMenuDue($menu->id, ['state' => 'loan_pending', 'attempts' => 0]);
    expect($h['service']->poll())->toBe(0)
        ->and($h['service']->process($menu->id)['state'])->toBe('not_claimed');
    organicMenuDue($menu->id, ['state' => 'loan_unknown']);
    expect($h['service']->poll())->toBe(0);
});

test('an awaiting choice row with a saved callback is fairly recovered after a worker race', function () {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu);
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    organicMenuDue($menu->id, ['state' => 'awaiting_choice']);

    expect($h['service']->poll())->toBe(0);
    DB::table('jobs')->delete(); // ACK the callback's already queued worker.
    expect($h['service']->poll())->toBe(1);
});

test('old web history does not swallow a new organic recurrent entry when the menu is enabled', function () {
    $old = organicMenuEvent();
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => $old->id, 'submission_id' => (string) Str::uuid(),
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'state' => 'routed',
        'proof' => json_encode(organicMenuProof($old)), 'transfer_state' => 'confirmed', 'created_at' => now()->subDays(7), 'updated_at' => now()->subDays(7)]);
    expect((new WebFormChatRouting)->validHistory(DB::table('web_form_chat_routes')->first()))->toBeTrue();
    $event = organicMenuEvent();

    expect((new EdnaIntake)->receiveEntry($event, organicMenuPayload($event)))->toBeTrue()
        ->and(DB::table('edna_organic_menus')->where('entry_event_id', $event->id)->exists())->toBeTrue()
        ->and(DB::table('web_form_continuations')->where('entry_event_id', $event->id)->exists())->toBeFalse();
    Queue::assertPushed(ProcessEdnaOrganicMenu::class, 1);
});

test('the recovery command splits one bounded budget between loan and menu queues', function () {
    $loans = Mockery::mock(EdnaOrganicLoan::class);
    $loans->shouldReceive('poll')->once()->with(25)->andReturn(7);
    app()->instance(EdnaOrganicLoan::class, $loans);
    $menus = Mockery::mock(EdnaOrganicMenu::class);
    $menus->shouldReceive('poll')->once()->with(18)->andReturn(3);
    app()->instance(EdnaOrganicMenu::class, $menus);

    $this->artisan('edna:organic-menus', ['action' => 'poll'])
        ->expectsOutput('{"enqueued":10,"loan_enqueued":7,"menu_enqueued":3}')->assertSuccessful();
    Http::assertNothingSent();
});

test('capture queue failure rolls back the new menu rather than leaving an orphan', function () {
    $h = organicMenuHarness();
    $entry = organicMenuEvent();
    Event::listen(JobQueued::class, fn () => throw new RuntimeException('queue unavailable'));

    expect(fn () => $h['service']->receiveEntry($entry, organicMenuPayload($entry)))->toThrow(RuntimeException::class)
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('jobs')->count())->toBe(0)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(0)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(0);
});

test('the organic status command is read only', function () {
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    $before = (array) DB::table('edna_organic_menus')->find($menu->id);
    $this->artisan('edna:organic-menus', ['action' => 'status'])->assertSuccessful();

    expect((array) DB::table('edna_organic_menus')->find($menu->id))->toBe($before);
    Queue::assertPushed(ProcessEdnaOrganicMenu::class, 1);
    Http::assertNothingSent();
});

test('a provisional seller watch reads the exact deal without a second intake and preserves later attention', function (string $scenario) {
    if ($scenario === 'weekend') {
        $this->travelTo(now()->setDate(2026, 11, 20)->setTime(20, 0));
    }
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h, '');
    $evidence = json_decode($menu->profile_evidence, true);
    $waiting = $evidence['assigned_case'];
    unset($waiting['seller_id']);
    $waiting['contact_deal_activity'] = false;
    organicMenuDue($menu->id, ['state' => 'seller_wait', 'attempts' => 13, 'seller_id' => null,
        'profile_evidence' => json_encode(['waiting_case' => $waiting])]);
    $deal = organicMenuAssignedDeal('');
    $queued = array_replace($deal, ['STAGE_ID' => 'C1:KESTRA_QUEUE', 'ASSIGNED_BY_ID' => '74827']);
    if ($scenario === 'weekend') {
        $queued['ASSIGNED_BY_ID'] = '57';
        $queued['DATE_CREATE'] = now()->toIso8601String();
        $queued['UF_CRM_KQ_REASON'] = 'waiting_for_sales_opening|2026-11-20T20:00:00Z|2026-11-24T12:00:00Z|anses_approved';
    }
    $deals = [$queued, $deal];
    if ($scenario === 'changed-contact') {
        $deals[1]['CONTACT_ID'] = '211';
    } elseif ($scenario === 'response') {
        $deals[1]['STAGE_ID'] = 'C1:UC_ZH5DGU';
    } elseif ($scenario === 'response-before-post') {
        $deals = [$queued, $deal, $deal, array_replace($deal, ['STAGE_ID' => 'C1:UC_ZH5DGU'])];
    }
    $h['crm']->shouldReceive('call')->with('crm.deal.get', ['id' => '110'])->andReturn(...$deals);
    $h['crm']->shouldReceive('call')->with('crm.contact.get', ['id' => '210'])
        ->andReturn(['ID' => '210', 'UF_CRM_65B7E48033FCD' => '20301234563']);
    if ($scenario === 'taken' || $scenario === 'session') {
        $h['attention']->shouldReceive('inspect')->andReturn(['status' => 'preserved',
            'reason' => $scenario === 'taken' ? 'human_chat_owner' : 'session_changed']);
    }
    if (in_array($scenario, ['available', 'weekend'], true)) {
        $h['crm']->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => 601, 'USER_ID' => 29])->andReturnTrue();
        $h['crm']->shouldReceive('call')->once()->with('imopenlines.dialog.get', ['CHAT_ID' => 601])
            ->andReturn(['id' => 601, 'owner' => 29, 'entity_data_1' => 'Y|LEAD|101|N|N|501|1794400000', 'text_field_enabled' => true]);
    }
    expect($h['service']->process($menu->id)['state'])->toBe('seller_wait');
    if ($scenario === 'weekend') {
        $open = now()->setDate(2026, 11, 24)->setTime(12, 0);
        $paused = DB::table('edna_organic_menus')->find($menu->id);
        expect($paused->available_at)->toBe($open->toDateTimeString())
            ->and($paused->expires_at)->toBe($open->copy()->addHours(8)->toDateTimeString());
        $this->travelTo($open);
    }
    organicMenuDue($menu->id);
    expect($h['service']->process($menu->id)['state'])->toBe(in_array($scenario, ['available', 'weekend'], true) ? 'unknown' : 'preserved');
    if (in_array($scenario, ['available', 'weekend'], true)) {
        organicMenuDue($menu->id);
        expect($h['service']->process($menu->id)['state'])->toBe('routed')
            ->and(DB::table('edna_organic_menus')->find($menu->id)->transfer_state)->toBe('confirmed');
    } else {
        $h['crm']->shouldNotHaveReceived('call', ['imopenlines.operator.transfer', Mockery::any()]);
    }
    expect(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
})->with(['available', 'weekend', 'taken', 'session', 'changed-contact', 'response', 'response-before-post']);

test('a deal returned to routing review after the seller acknowledgement is preserved before transfer', function () {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h);
    $deal = organicMenuAssignedDeal('310');
    $deal['STAGE_ID'] = 'C1:KESTRA_ROUTE_REVIEW';
    $h['crm']->shouldReceive('call')->once()->with('crm.deal.get', ['id' => '110'])->andReturn($deal);
    expect($h['service']->process($menu->id)['reason'])->toBe('commercial_assignment_changed');
});

test('an assigned case contact changed before the first CRM read is preserved against the backend acknowledgement', function () {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h);
    $h['crm']->shouldReceive('call')->once()->with('crm.deal.get', ['id' => '110'])->andReturn(organicMenuAssignedDeal('310', '211'));

    expect($h['service']->process($menu->id)['reason'])->toBe('commercial_assignment_changed')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('preserved');
    $h['crm']->shouldNotHaveReceived('call', ['imopenlines.operator.transfer', Mockery::any()]);
});

test('an exact acknowledged assigned case revalidates identity on every read and routes once', function (string $leadId) {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h, $leadId);
    $h['crm']->shouldReceive('call')->times(3)->with('crm.deal.get', ['id' => '110'])->andReturn(organicMenuAssignedDeal($leadId));
    $h['crm']->shouldReceive('call')->times(3)->with('crm.contact.get', ['id' => '210'])
        ->andReturn(['ID' => '210', 'UF_CRM_65B7E48033FCD' => '20-30123456-3']);
    if ($leadId !== '') {
        $h['crm']->shouldReceive('call')->times(3)->with('crm.lead.get', ['id' => $leadId])
            ->andReturn(['ID' => $leadId, 'CONTACT_ID' => '210', 'UF_CRM_1693840106704' => '20301234563']);
    }
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => 601, 'USER_ID' => 29])->andReturnTrue();
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.dialog.get', ['CHAT_ID' => 601])
        ->andReturn(['id' => 601, 'owner' => 29, 'entity_data_1' => 'Y|LEAD|101|N|N|501|1794400000', 'text_field_enabled' => true]);

    expect($h['service']->process($menu->id)['state'])->toBe('unknown');
    organicMenuDue($menu->id);
    expect($h['service']->process($menu->id)['state'])->toBe('routed')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->transfer_state)->toBe('confirmed');
})->with(['310', '']);

test('missing assigned case evidence or a different profile hash cannot become a new CRM baseline', function (bool $missing) {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h);
    $evidence = json_decode($menu->profile_evidence, true, 32, JSON_THROW_ON_ERROR);
    if ($missing) {
        unset($evidence['assigned_case']);
    } else {
        $evidence['assigned_case']['profile_identity_hash'] = str_repeat('b', 64);
    }
    organicMenuDue($menu->id, ['profile_evidence' => json_encode($evidence, JSON_THROW_ON_ERROR)]);

    expect($h['service']->process($menu->id)['state'])->toBe('preserved');
    $h['crm']->shouldNotHaveReceived('call');
})->with([true, false]);

test('a changed or cleared acknowledged person identity prevents assignment', function (bool $leadChanged) {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h);
    $h['crm']->shouldReceive('call')->once()->with('crm.deal.get', ['id' => '110'])->andReturn(organicMenuAssignedDeal());
    $h['crm']->shouldReceive('call')->once()->with('crm.contact.get', ['id' => '210'])
        ->andReturn(['ID' => '210', 'UF_CRM_65B7E48033FCD' => $leadChanged ? '20301234563' : '']);
    if ($leadChanged) {
        $h['crm']->shouldReceive('call')->once()->with('crm.lead.get', ['id' => '310'])
            ->andReturn(['ID' => '310', 'CONTACT_ID' => '210', 'UF_CRM_1693840106704' => '20987654326']);
    }

    expect($h['service']->process($menu->id)['state'])->toBe('preserved');
    $h['crm']->shouldNotHaveReceived('call', ['imopenlines.operator.transfer', Mockery::any()]);
})->with([true, false]);

test('a contact change after the initial commercial read is stopped by the final acknowledgement comparison', function () {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h);
    $h['crm']->shouldReceive('call')->twice()->with('crm.deal.get', ['id' => '110'])
        ->andReturn(organicMenuAssignedDeal(), organicMenuAssignedDeal('310', '211'));
    $h['crm']->shouldReceive('call')->once()->with('crm.contact.get', ['id' => '210'])
        ->andReturn(['ID' => '210', 'UF_CRM_65B7E48033FCD' => '20301234563']);
    $h['crm']->shouldReceive('call')->once()->with('crm.lead.get', ['id' => '310'])
        ->andReturn(['ID' => '310', 'CONTACT_ID' => '210', 'UF_CRM_1693840106704' => '20301234563']);

    expect($h['service']->process($menu->id)['reason'])->toBe('routing_context_changed')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('preserved');
    $h['crm']->shouldNotHaveReceived('call', ['imopenlines.operator.transfer', Mockery::any()]);
});

function organicMenuBoundWebContext(): array
{
    $input = ['celular' => '3510000000', 'cuil' => '20301234563',
        '_journey_links' => ['submission_id' => (string) Str::uuid()]];
    $reference = app(WebFormReceipt::class)->register($input);
    DB::table('web_form_receipts')->where('id', $input['_journey_links']['submission_id'])
        ->update(['state' => 'synced', 'lead_id' => '101', 'contact_id' => '301']);
    $receipt = DB::table('web_form_receipts')->find($input['_journey_links']['submission_id']);
    $anchor = organicMenuEvent(['messageContent' => ['text' => '(solicitud: '.$reference.')']]);
    $continuity = new WebChatContinuity;
    $id = $continuity->captureReference($anchor, $receipt);
    expect($id)->toBeInt()
        ->and($continuity->bind((int) $anchor->id, organicMenuProof($anchor))['status'])->toBe('bound');

    return [$id, $reference, $receipt];
}

test('a web context established during the last welcome checks prevents scheduling', function (string $phase) {
    DB::table('edna_intake_cutovers')->insert(['name' => WebChatContinuity::NAME,
        'entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    $h = organicMenuHarness();
    $event = organicMenuEvent();
    $menu = organicMenuCapture($h['service'], $event);
    expect((new WebChatContinuity)->blocksOutbound($event))->toBeFalse();
    $createContext = function (): void {
        organicMenuBoundWebContext();
    };
    if ($phase === 'channel') {
        $h['transport']->shouldReceive('assertChannel')->once()->andReturnUsing($createContext);
        $h['attention']->shouldReceive('inspectWelcome')->twice()
            ->andReturn(['status' => 'ready', 'owner_id' => '0', 'session_id' => '501']);
    } else {
        $h['transport']->shouldReceive('assertChannel')->once()->andReturnNull();
        $inspections = 0;
        $h['attention']->shouldReceive('inspectWelcome')->twice()->andReturnUsing(function () use (&$inspections, $createContext) {
            if (++$inspections === 2) {
                $createContext();
            }

            return ['status' => 'ready', 'owner_id' => '0', 'session_id' => '501'];
        });
    }
    $h['transport']->shouldNotReceive('schedule');

    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'web_continuity_priority']);
    $saved = DB::table('edna_organic_menus')->find($menu->id);
    expect($saved)->toMatchObject(['state' => 'preserved', 'send_state' => 'pending', 'send_started_at' => null])
        ->and(json_decode($saved->proof, true)['session_id'])->toBe('501')
        ->and(DB::table('web_chat_contexts')->first())->toMatchObject(['state' => 'bound', 'chat_id' => 601, 'session_id' => 501]);
    $h['transport']->shouldNotHaveReceived('schedule');
    Http::assertNothingSent();
})->with(['channel', 'second-inspection']);

test('a released explicit reference reenters the real intake and creates its new session menu once', function () {
    foreach ([WebChatContinuity::NAME, 'native-v3-v1'] as $name) {
        DB::table('edna_intake_cutovers')->insert(['name' => $name,
            'entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    }
    $h = organicMenuHarness();
    app()->instance(EdnaOrganicMenu::class, $h['service']);
    [$id, $reference] = organicMenuBoundWebContext();
    $callback = organicMenuEvent(['messageContent' => ['text' => '(solicitud: '.$reference.')']]);
    $payload = organicMenuPayload($callback);
    expect((new EdnaIntake)->receiveEntry($callback, $payload))->toBeTrue()
        ->and(DB::table('edna_organic_menus')->count())->toBe(0);
    $initialRoutes = DB::table('web_form_chat_routes')->count();
    $proof = organicMenuProof($callback, 502);
    $proof['activity_id'] = '802';
    $continuity = new WebChatContinuity;

    expect($continuity->bind((int) $callback->id, $proof))->toMatchArray(['status' => 'released', 'rerouted' => true]);
    // The same callback or its queued former web route cannot reopen the old path.
    expect($continuity->bind((int) $callback->id, $proof)['status'])->toBe('released');
    expect((new EdnaIntake)->receiveEntry($callback, $payload))->toBeTrue();
    expect(DB::table('web_form_continuations')->where('entry_event_id', $callback->id)->first())
        ->toMatchObject(['state' => 'released', 'reason' => 'web_context_session_changed', 'proof_source' => 'web_context'])
        ->and(DB::table('web_chat_contexts')->find($id)->state)->toBe('released')
        ->and(DB::table('web_form_chat_routes')->count())->toBe($initialRoutes)
        ->and(DB::table('edna_organic_menus')->where('entry_event_id', $callback->id)->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertPushed(ProcessEdnaOrganicMenu::class, 1);
    Http::assertNothingSent();
});

test('a benefits activation reply is routed without sending the general menu', function () {
    $h = organicMenuHarness();
    $event = organicMenuEvent(['messageContent' => ['type' => 'BUTTON', 'text' => 'Sí, quiero activarla'],
        'replyOutMessageId' => '317620969', 'replyOutMessageExternalRequestId' => '317620969']);
    $menu = organicMenuCapture($h['service'], $event);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->once()->withArgs(fn ($e, $p) => $e->id === $event->id
        && $p['entry_event_id'] === $event->id && $p['chat_id'] === '601')
        ->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);
    $h['transport']->shouldNotReceive('schedule');
    $h['attention']->shouldNotReceive('inspectWelcome');

    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'benefits_routing'])
        ->and(DB::table('edna_organic_menus')->find($menu->id))->toMatchObject([
            'send_state' => 'pending', 'send_started_at' => null, 'transfer_state' => 'preserved'])
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
});

test('a benefits case discovered during the final welcome checks prevents the menu POST', function () {
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->twice()->andReturn(null, ['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);
    $h['transport']->shouldReceive('assertChannel')->once()->andReturnNull();
    $h['transport']->shouldNotReceive('schedule');

    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'benefits_routing'])
        ->and(DB::table('edna_organic_menus')->find($menu->id)->send_started_at)->toBeNull();
    Http::assertNothingSent();
});

test('incomplete or ambiguous benefits evidence cannot authorize a greeting', function (string $state) {
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->once()->andReturn(['state' => $state, 'reason' => 'benefits_case_unavailable']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);
    $h['transport']->shouldNotReceive('schedule');

    expect($h['service']->process($menu->id))->toMatchArray(['state' => $state, 'reason' => 'benefits_case_unavailable'])
        ->and(DB::table('edna_organic_menus')->find($menu->id)->send_started_at)->toBeNull();
    Http::assertNothingSent();
})->with(['waiting', 'review']);

test('a new choice on an older menu uses its own native message for benefits continuity', function () {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu);
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    organicMenuDue($menu->id);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->once()->withArgs(fn ($e, $p) => $e->id === $choice->id
        && $p['entry_event_id'] === $choice->id && $p['entry_message_id'] === $choice->message_id)
        ->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);
    $h['crm']->shouldNotReceive('call');

    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'benefits_routing'])
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
});

test('an uncertain greeting is only reconciled and never converted into a fresh benefits attempt', function () {
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    $h['service']->process($menu->id);
    organicMenuDue($menu->id);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldNotReceive('check');
    app()->instance(EdnaBenefitsRouting::class, $benefits);

    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'awaiting_choice', 'reason' => 'menu_outgoing_confirmed']);
    Http::assertNothingSent();
});

test('human acceptance during the final benefits reads is checked before sending the menu', function () {
    $accepted = false;
    $h = organicMenuHarness();
    $menu = organicMenuCapture($h['service']);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $calls = 0;
    $benefits->shouldReceive('check')->twice()->andReturnUsing(function () use (&$calls, &$accepted) {
        $accepted = ++$calls === 2;

        return null;
    });
    app()->instance(EdnaBenefitsRouting::class, $benefits);
    $h['attention']->shouldReceive('inspectWelcome')->twice()->andReturnUsing(function () use (&$accepted) {
        return $accepted
            ? ['status' => 'preserved', 'reason' => 'operator_attention_preserved', 'owner_id' => '0', 'session_id' => '501']
            : ['status' => 'ready', 'owner_id' => '0', 'session_id' => '501'];
    });
    $h['transport']->shouldNotReceive('schedule');

    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'operator_attention_preserved']);
    Http::assertNothingSent();
});

test('a label-only button can elect precisely its confirmed menu and routes the same native session', function () {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $reply = organicMenuChoice($menu, 'other', ['messageContent' => ['type' => 'BUTTON', 'text' => 'Otra consulta', 'payload' => null]]);
    expect($h['service']->receiveChoice($reply, organicMenuPayload($reply)))->toBeTrue();
    expect(DB::table('edna_organic_menus')->find($menu->id)->choice)->toBe('other');
    $h['crm']->shouldReceive('call')->once()->with('imopenlines.operator.transfer', ['CHAT_ID' => 601, 'USER_ID' => 5737])->andReturnTrue();
    expect($h['service']->process($menu->id)['reason'])->toBe('transfer_confirmation_pending');
});

test('text or a malformed token cannot impersonate a choice with its label', function (string $type, ?string $token) {
    $h = organicMenuHarness();
    $menu = organicMenuConfirmed($h);
    $reply = organicMenuChoice($menu, 'other', ['messageContent' => ['type' => $type, 'text' => 'Otra consulta', 'payload' => $token]]);
    expect($h['service']->receiveChoice($reply, organicMenuPayload($reply)))->toBeTrue()
        ->and(DB::table('edna_organic_menus')->find($menu->id)->choice_event_id)->toBeNull();
})->with([['TEXT', null], ['BUTTON', 'broken-token']]);

test('a temporary chat lock preserves the acknowledged commercial route for a recurrent borrower', function () {
    $h = organicMenuHarness();
    $menu = organicMenuAssignedCase($h);
    $lock = Cache::lock('web-form-chat:601', 120, 'agent');
    expect($lock->get())->toBeTrue();
    try {
        expect($h['service']->process($menu->id))->toMatchArray(['state' => 'route_pending', 'reason' => 'chat_routing_in_progress']);
        expect(DB::table('edna_flow_sends')->count())->toBe(0);
    } finally {
        $lock->release();
    }
    organicMenuDue($menu->id);
    $deal = organicMenuAssignedDeal();
    $deal['CONTACT_ID'] = '211';
    $h['crm']->shouldReceive('call')->once()->with('crm.deal.get', ['id' => '110'])->andReturn($deal);
    expect($h['service']->process($menu->id)['reason'])->toBe('commercial_assignment_changed');
});

test('an organic choice cannot send an expired chat to the commercial desk', function () {
    fakeSalesTransferWindow('expired');
    $h = organicMenuHarness();
    $h['attention']->shouldReceive('canTransfer', 'compatible')->andReturnTrue();
    $menu = organicMenuConfirmed($h);
    $choice = organicMenuChoice($menu, 'other');
    $h['service']->receiveChoice($choice, organicMenuPayload($choice));
    expect($h['service']->process($menu->id))->toMatchArray(['state' => 'expired', 'reason' => 'customer_window_expired'])
        ->and(DB::table('edna_organic_menus')->find($menu->id)->transfer_intent)->toBeNull();
    $h['crm']->shouldNotHaveReceived('call', ['imopenlines.operator.transfer', Mockery::any()]);
});
