<?php

use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\SendEdnaFlow;
use App\Services\EdnaOrganicMenu;
use App\Services\WebChatContinuity;
use App\Services\WebFormContinuation;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 18)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('i', 32)));
    config()->set('cache.default', 'array');
    config()->set('edna', ['enabled' => true, 'webhook_key' => 'continuity-fixture', 'auth_header' => 'Authorization',
        'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/incoming',
        'router_enabled' => true, 'router_start_at' => now()->subDays(3)->toIso8601String(), 'router_recipients' => [],
        'api_key' => 'fixture', 'cascade_id' => '2557', 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '999000111222333', 'intake_start_at' => now()->subDays(2)->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'continuity-test', 'intake_pilot_limit' => 'unlimited',
        'organic_menu_enabled' => true, 'organic_menu_start_at' => now()->subDay()->toIso8601String(),
        'organic_other_operator_id' => 5737,
        'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/test']);
    foreach (['native-v3-v1', WebChatContinuity::NAME] as $name) {
        DB::table('edna_intake_cutovers')->insert(['name' => $name, 'entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    }
    Http::preventStrayRequests();
    Queue::fake();
});

function webContinuityInput(): array
{
    return ['celular' => '3510000000', 'cuil' => '20301234563', '_journey_links' => ['submission_id' => (string) Str::uuid()]];
}

function webContinuityIncoming(string $text, string $type = 'TEXT', ?string $received = null): object
{
    test()->postJson('/api/webhooks/edna/incoming', ['id' => (string) (800000 + DB::table('edna_incoming_events')->count()),
        'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => $received ?? now()->toIso8601String(), 'messageContent' => ['type' => $type, 'text' => $text]],
        ['Authorization' => 'Token continuity-fixture'])->assertOk();
    $event = DB::table('edna_incoming_events')->latest('id')->first();
    (new ReceiveEdnaInKestra($event->id))->handle();

    return $event;
}

test('the 121095 sequence keeps the referenced web request across later messages without another menu or v3', function () {
    $input = webContinuityInput();
    $reference = app(WebFormReceipt::class)->register($input);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '428617', 'contact_id' => '205259'], true);
    $anchor = webContinuityIncoming('Ya completé el formulario (solicitud: '.$reference.')');
    $context = DB::table('web_chat_contexts')->first();
    foreach (['TEXT', 'IMAGE', 'BUTTON'] as $type) {
        $this->travel(20)->seconds();
        $event = webContinuityIncoming('Quiero continuar', $type);
        (new ReceiveEdnaInKestra($event->id))->handle();
        expect(DB::table('web_form_continuations')->where('entry_event_id', $event->id)->first())
            ->toMatchObject(['context_id' => $context->id, 'submission_id' => $input['_journey_links']['submission_id'],
                'state' => 'ready', 'proof_source' => 'web_context']);
    }
    expect($context->anchor_entry_event_id)->toBe($anchor->id)
        ->and(DB::table('web_chat_contexts')->count())->toBe(1)
        ->and(DB::table('web_form_continuations')->count())->toBe(4)
        ->and(DB::table('web_form_chat_routes')->count())->toBe(4)
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
});

test('an unacknowledged web request keeps followup messages waiting until its original receipt is acknowledged', function () {
    $input = webContinuityInput();
    $reference = app(WebFormReceipt::class)->register($input);
    webContinuityIncoming('(solicitud: '.$reference.')');
    webContinuityIncoming('¿Llegó mi solicitud?');
    expect(DB::table('web_form_continuations')->pluck('state')->unique()->all())->toBe(['waiting']);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '428617', 'contact_id' => '205259'], true);
    expect(DB::table('web_form_continuations')->pluck('state')->unique()->all())->toBe(['ready'])
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
});

test('a queued greeting is cancelled when a new referenced web request wins before its send', function () {
    webContinuityIncoming('Hola');
    $menu = DB::table('edna_organic_menus')->first();
    $input = webContinuityInput();
    $reference = app(WebFormReceipt::class)->register($input);
    webContinuityIncoming('(solicitud: '.$reference.')');
    expect(app(EdnaOrganicMenu::class)->process($menu->id))->toMatchArray(['state' => 'preserved', 'reason' => 'web_continuity_priority']);
    expect(DB::table('edna_organic_menus')->find($menu->id)->send_state)->toBe('pending');
    Http::assertNothingSent();
});

test('a pending v3 is cancelled at its final claim when a valid web context arrived meanwhile', function () {
    config()->set('edna.organic_menu_enabled', false);
    webContinuityIncoming('Hola');
    $send = DB::table('edna_flow_sends')->first();
    expect($send)->not->toBeNull();
    $input = webContinuityInput();
    $reference = app(WebFormReceipt::class)->register($input);
    webContinuityIncoming('(solicitud: '.$reference.')');
    $claimed = false;
    $result = app(WebFormContinuation::class)->claimFlow($send, function () use (&$claimed) {
        $claimed = true;

        return true;
    });
    expect($result)->toBeFalse()->and($claimed)->toBeFalse()
        ->and(DB::table('edna_flow_sends')->find($send->id))->toMatchObject(['state' => 'cancelled', 'reason' => 'web_continuity_priority']);
    Http::assertNothingSent();
});

test('an old web receipt cannot establish inherited continuity for new messages', function () {
    $input = webContinuityInput();
    $reference = app(WebFormReceipt::class)->register($input);
    DB::table('web_form_receipts')->where('id', $input['_journey_links']['submission_id'])->update(['created_at' => now()->subHours(2)]);
    webContinuityIncoming('(solicitud: '.$reference.')');
    $next = webContinuityIncoming('Otra consulta');
    expect(DB::table('web_chat_contexts')->count())->toBe(0)
        ->and(DB::table('web_form_continuations')->where('entry_event_id', $next->id)->exists())->toBeFalse()
        ->and(DB::table('edna_organic_menus')->where('entry_event_id', $next->id)->exists())->toBeTrue();
    Http::assertNothingSent();
});

test('a delayed predeployment callback cannot create a context even with a recent valid receipt', function () {
    $input = webContinuityInput();
    $reference = app(WebFormReceipt::class)->register($input);
    webContinuityIncoming('(solicitud: '.$reference.')', 'TEXT', now()->subHours(2)->toIso8601String());
    expect(DB::table('web_chat_contexts')->count())->toBe(0);
    Http::assertNothingSent();
});
