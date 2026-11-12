<?php

use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaIntake;
use App\Services\EdnaMessageBinding;
use App\Services\EdnaOrganicMenu;
use App\Services\EdnaOrganicTransport;
use App\Services\EdnaPaidEntry;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 11)->setTime(15, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('p', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'organic_menu_enabled' => true,
        'subject_id' => '2423', 'api_key' => 'paid-entry-fixture', 'cascade_id' => '2557',
        'router_start_at' => now()->subDay()->toIso8601String(), 'organic_menu_start_at' => now()->subDay()->toIso8601String(),
        'intake_enabled' => true, 'intake_crm_enabled' => true, 'intake_flow_id' => '950118281197789',
        'intake_start_at' => now()->subDay()->toIso8601String(), 'intake_entry_scope' => 'sales_channel',
        'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(), 'intake_pilot_id' => 'paid-entry-test',
        'intake_pilot_limit' => 'unlimited', 'router_recipients' => [], 'intake_recipients' => []]);
    Queue::fake();
    Http::preventStrayRequests();
});

function paidEntryFixture(array $changes = []): array
{
    $message = (string) (970000 + DB::table('edna_incoming_events')->count());
    $payload = array_replace_recursive(['id' => $message, 'subjectId' => '2423',
        'subscriber' => ['identifier' => '5493510000000'], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola']], $changes);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => $payload['subjectId'],
        'message_id' => $message, 'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
        'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);

    return [DB::table('edna_incoming_events')->find($id), $payload];
}

function paidJourneyFixture(array $touch = [], ?array $first = null): object
{
    $last = array_replace(['utm_source' => 'google', 'utm_medium' => 'cpc', 'at' => now()->subMinute()->toIso8601String()], $touch);

    return (new AttributionJourney)->create(['version' => 1, 'first' => $first ?? $last, 'last' => $last]);
}

test('authenticated ad referrals go straight to the existing v3 without reserving a menu', function (array $referral) {
    [$event, $payload] = paidEntryFixture(['messageContent' => ['referral' => $referral]]);

    expect((new EdnaIntake)->receiveEntry($event, $payload))->toBeTrue();
    $send = DB::table('edna_flow_sends')->sole();
    $snapshot = json_decode(Crypt::decryptString($send->attribution_snapshot), true);
    expect(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and($send->flow_id)->toBe('950118281197789')
        ->and($snapshot['entry_routing']['route'])->toBe('paid_direct_v3')
        ->and($snapshot['entry_routing']['evidence']['kind'])->toBe('provider_ad_referral')
        ->and($snapshot['referral'])->toBe($referral)
        ->and($snapshot['status'])->toBe('unknown')->and($snapshot['first'])->toBe([]);
    Queue::assertPushed(SendEdnaFlow::class, fn ($job) => $job->sendId === $send->id);
    Queue::assertNotPushed(ProcessEdnaOrganicMenu::class);
    Http::assertNothingSent();
})->with([
    [['sourceType' => 'ad', 'sourceId' => '1234567', 'sourceUrl' => 'https://www.facebook.com/ads/1234567']],
    [['source_type' => 'ad', 'source_id' => '1234567']],
]);

test('a declared ad prefill is paid without inventing its campaign or platform', function (string $text) {
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => $text]]);
    $decision = (new EdnaPaidEntry)->classify($event, $payload);
    expect($decision['evidence'])->toBe(['kind' => 'documented_ad_prefill', 'network' => 'unknown',
        'template_id' => 'account_loan_ad_20261111']);
    (new EdnaIntake)->receiveEntry($event, $payload);
    expect(DB::table('edna_organic_menus')->count())->toBe(0)->and(DB::table('edna_flow_sends')->count())->toBe(1);
})->with([
    '¡Hola! Vi un anuncio de *Red Unisol* y quiero info sobre préstamos. Acepto ser contactado por este medio.',
    'HOLA, VI UN ANUNCIO DE RED UNISOL Y QUIERO INFO SOBRE PRESTAMOS. ACEPTO SER CONTACTADO POR ESTE MEDIO!',
]);

test('documented Google reference codes preserve labels without manufacturing numeric ad identifiers', function (string $code) {
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => 'Quiero un préstamo (ref: '.$code.')']]);
    $decision = (new EdnaPaidEntry)->classify($event, $payload);
    expect($decision['evidence'])->toBe(['kind' => 'google_campaign_code', 'network' => 'google', 'campaign_code' => strtoupper($code)]);
    (new EdnaIntake)->receiveEntry($event, $payload);
    $snapshot = json_decode(Crypt::decryptString(DB::table('edna_flow_sends')->sole()->attribution_snapshot), true);
    expect($snapshot['entry_routing']['evidence'])->toBe($decision['evidence'])
        ->and($snapshot['journey_id'])->toBeNull()->and($snapshot['last'])->toBe([]);
})->with(['G-CBAJUB-MED', 'g-cuenta', 'G-CATSM-PURA']);

test('a current paid journey is classified without binding it and then frozen by the actual Flow reservation', function (array $touch) {
    $journey = paidJourneyFixture($touch);
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => 'Consulta (ref: '.$journey->id.')']]);
    $before = DB::table('attribution_journeys')->where('id', $journey->id)->first();
    $decision = (new EdnaPaidEntry)->classify($event, $payload);
    expect($decision['evidence']['kind'])->toBe('tracked_paid_click')
        ->and($decision['evidence']['journey_id'])->toBe($journey->id)
        ->and((array) DB::table('attribution_journeys')->where('id', $journey->id)->first())->toBe((array) $before);
    (new EdnaIntake)->receiveEntry($event, $payload);
    $send = DB::table('edna_flow_sends')->sole();
    $snapshot = json_decode(Crypt::decryptString($send->attribution_snapshot), true);
    expect($send->entry_origin)->toBe('website')->and($snapshot['status'])->toBe('resolved')
        ->and($snapshot['journey_id'])->toBe($journey->id)->and($snapshot['last'])->toBe((new AttributionJourney)->snapshot($journey)['last'])
        ->and($snapshot['entry_routing']['evidence'])->toBe($decision['evidence'])
        ->and(DB::table('edna_organic_menus')->count())->toBe(0);
})->with([
    [['utm_source' => 'google', 'utm_medium' => '', 'gclid' => 'current-click-fixture']],
    [['utm_source' => 'google', 'utm_medium' => '', 'gbraid' => 'current-braid-fixture']],
    [['utm_source' => 'google', 'utm_medium' => '', 'wbraid' => 'current-braid-fixture']],
    [['utm_source' => 'fb', 'utm_medium' => 'paid_social']],
    [['utm_source' => 'ig', 'utm_medium' => 'paid']],
    [['utm_source' => 'fb', 'utm_medium' => 'Paid Media']],
    [['utm_source' => 'ig', 'utm_medium' => 'paid-media']],
    [['utm_source' => 'google', 'utm_medium' => 'cpc']],
]);

test('social source click IDs old attribution and assistance alone are not evidence of a current paid entry', function (array $touch) {
    $journey = paidJourneyFixture($touch, ['utm_source' => 'google', 'utm_medium' => 'cpc', 'at' => now()->subDays(10)->toIso8601String()]);
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => 'Consulta (ref: '.$journey->id.')']]);
    expect((new EdnaPaidEntry)->classify($event, $payload))->toBeNull();
    (new EdnaIntake)->receiveEntry($event, $payload);
    expect(DB::table('edna_organic_menus')->count())->toBe(1)->and(DB::table('edna_flow_sends')->count())->toBe(0);
})->with([
    [['utm_source' => 'fb', 'utm_medium' => 'social', 'fbclid' => 'ordinary-social-click']],
    [['utm_source' => 'ig', 'utm_medium' => 'organic']],
    [['utm_source' => 'google', 'utm_medium' => 'organic']],
    [['utm_source' => 'whatsapp', 'utm_medium' => 'messaging', 'utm_campaign' => 'web_whatsapp_router', 'gclid' => 'transport-is-not-acquisition']],
    [['at' => '2026-11-08T15:00:00Z']],
    [['at' => '2026-11-11T16:00:00Z']],
]);

test('a journey belonging to another phone channel or expired reference cannot classify this entry as paid', function (string $change) {
    $journey = paidJourneyFixture();
    DB::table('attribution_journeys')->where('id', $journey->id)->update(match ($change) {
        'phone' => ['recipient_hash' => (new AttributionJourney)->phoneHash('5493510000001'), 'subject_id' => '2423'],
        'channel' => ['recipient_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'subject_id' => '9999'],
        default => ['expires_at' => now()->subSecond()],
    });
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => 'Consulta (ref: '.$journey->id.')']]);
    expect((new EdnaPaidEntry)->classify($event, $payload))->toBeNull();
})->with(['phone', 'channel', 'expired']);

test('non-ad referrals unknown campaign labels and plain inquiries retain the general menu', function (array $changes) {
    [$event, $payload] = paidEntryFixture($changes);
    expect((new EdnaPaidEntry)->classify($event, $payload))->toBeNull();
    (new EdnaIntake)->receiveEntry($event, $payload);
    expect(DB::table('edna_organic_menus')->count())->toBe(1)->and(DB::table('edna_flow_sends')->count())->toBe(0);
})->with([
    [['messageContent' => ['referral' => ['sourceType' => 'post', 'sourceId' => '12345']]]],
    [['messageContent' => ['referral' => ['sourceType' => 'ad', 'source_type' => 'post', 'sourceId' => '12345']]]],
    [['messageContent' => ['referral' => ['headline' => 'Anuncio', 'source_url' => 'https://facebook.com/example']]]],
    [['messageContent' => ['text' => 'Consulta (ref: G-RENEBND2BG)']]],
    [['messageContent' => ['text' => 'Consulta (ref: G-CUENTA) (ref: G-CBAJUB-MED)']]],
    [['messageContent' => ['text' => 'Hola, ya soy socio y quiero consultar']]],
]);

test('completed or uncertain web continuations retain priority over a declared paid entry', function (bool $confirmed) {
    $input = ['celular' => '5493510000000', 'cuil' => '20123456786', '_journey_links' => ['submission_id' => (string) Str::uuid()]];
    $reference = (new WebFormReceipt)->register($input);
    if ($confirmed) {
        (new WebFormReceipt)->result($input, ['ok' => true, 'lead_id' => '101'], true);
    }
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => '(solicitud: '.$reference.') (ref: G-CUENTA)']]);
    (new EdnaIntake)->receiveEntry($event, $payload);
    expect(DB::table('edna_organic_menus')->count())->toBe(0)->and(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('web_form_continuations')->sole()->state)->toBe($confirmed ? 'ready' : 'waiting');
})->with([true, false]);

test('caller-supplied acquisition cannot override the authenticated inbox', function () {
    [$event, $payload] = paidEntryFixture();
    $payload['messageContent']['referral'] = ['sourceType' => 'ad', 'sourceId' => 'fake-injected-ad'];
    expect((new EdnaPaidEntry)->classify($event, $payload))->toBeNull();
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

function paidPreviousMenu(object $event, array $changes = []): object
{
    $id = DB::table('edna_organic_menus')->insertGetId(array_replace([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => $event->id,
        'subject_id' => '2423', 'cascade_id' => '2557', 'recipient' => Crypt::encryptString('5493510000000'),
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
        'state' => 'pending', 'send_state' => 'pending', 'entry_received_at' => now(), 'expires_at' => now()->addDay(),
        'created_at' => now(), 'updated_at' => now(),
    ], $changes));

    return DB::table('edna_organic_menus')->find($id);
}

test('an old paid menu not yet sent changes route once without sending a greeting', function () {
    [$event] = paidEntryFixture(['messageContent' => ['text' => '(ref: G-CUENTA)']]);
    $menu = paidPreviousMenu($event);
    $service = app(EdnaOrganicMenu::class);
    expect($service->process($menu->id))->toBe(['state' => 'preserved', 'reason' => 'paid_entry_routed_direct_v3']);
    $saved = DB::table('edna_organic_menus')->find($menu->id);
    expect($saved->send_state)->toBe('pending')->and($saved->send_started_at)->toBeNull()
        ->and($saved->flow_send_id)->toBeGreaterThan(0)->and(DB::table('edna_flow_sends')->count())->toBe(1);
    $service->process($menu->id);
    expect(DB::table('edna_flow_sends')->count())->toBe(1);
    Http::assertNothingSent();
});

test('an already accepted general greeting only reconciles instead of starting another paid Flow', function () {
    [$event] = paidEntryFixture(['messageContent' => ['text' => '(ref: G-CUENTA)']]);
    $proof = ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => $event->id, 'entry_message_id' => $event->message_id, 'chat_id' => '601',
        'session_id' => '501', 'activity_id' => '801', 'message_id' => '701', 'native_lead_id' => '101'];
    $menu = paidPreviousMenu($event, ['state' => 'waiting', 'send_state' => 'accepted', 'send_started_at' => now()->subMinute(),
        'accepted_at' => now()->subMinute(), 'proof' => json_encode($proof), 'chat_id' => 601, 'session_id' => 501]);
    $transport = Mockery::mock(EdnaOrganicTransport::class);
    $transport->shouldReceive('reconcile')->once()->andReturn(['send_state' => 'confirmed', 'outgoing_message_id' => '901', 'confirmed_at' => now()]);
    $service = new EdnaOrganicMenu(null, null, $transport);
    expect($service->process($menu->id)['state'])->toBe('awaiting_choice')
        ->and(DB::table('edna_organic_menus')->find($menu->id)->send_state)->toBe('confirmed')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
    Queue::assertNotPushed(SendEdnaFlow::class);
});

test('an expired authoritative journey cannot be revived by a valid legacy copy', function () {
    $legacy = paidJourneyFixture();
    [$event, $payload] = paidEntryFixture(['messageContent' => ['text' => 'Consulta (ref: '.$legacy->id.')']]);
    config()->set('database.connections.journey', ['driver' => 'sqlite', 'database' => ':memory:', 'foreign_key_constraints' => true]);
    config()->set('attribution.connection', 'journey');
    DB::purge('journey');
    try {
        Schema::connection('journey')->create('attribution_journeys', function ($table) {
            $table->string('id')->primary();
            $table->text('snapshot');
            $table->string('recipient_hash')->nullable();
            $table->string('subject_id')->nullable();
            $table->timestamp('bound_at')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();
        });
        DB::connection('journey')->table('attribution_journeys')->insert(array_replace((array) $legacy, ['expires_at' => now()->subSecond()]));
        expect((new EdnaPaidEntry)->classify($event, $payload))->toBeNull()
            ->and(DB::connection()->table('attribution_journeys')->where('id', $legacy->id)->value('expires_at'))->toBe($legacy->expires_at)
            ->and(DB::connection('journey')->table('attribution_journeys')->where('id', $legacy->id)->count())->toBe(1);
    } finally {
        DB::purge('journey');
    }
});

test('an untagged follow-up waits for the paid binding and then preserves its exact session without a greeting', function () {
    [$first, $firstPayload] = paidEntryFixture(['messageContent' => ['text' => 'Consulta (ref: G-CUENTA)']]);
    (new EdnaIntake)->receiveEntry($first, $firstPayload);
    $send = DB::table('edna_flow_sends')->sole();
    [$follow, $payload] = paidEntryFixture();
    (new EdnaIntake)->receiveEntry($follow, $payload);
    $menu = DB::table('edna_organic_menus')->sole();
    $proof = fn ($entry) => ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => $entry->id, 'entry_message_id' => $entry->message_id, 'chat_id' => '601',
        'session_id' => '501', 'activity_id' => '801', 'message_id' => (string) (700 + $entry->id), 'native_lead_id' => '101'];
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolve')->once()->andReturn($proof($follow));
    $service = new EdnaOrganicMenu(null, $binding);
    expect($service->process($menu->id))->toBe(['state' => 'waiting', 'reason' => 'paid_intake_binding_pending']);
    $waiting = DB::table('edna_organic_menus')->find($menu->id);
    expect((string) $waiting->chat_id)->toBe('601')->and((string) $waiting->session_id)->toBe('501')
        ->and(json_decode($waiting->proof, true)['entry_event_id'])->toBe($follow->id);
    DB::table('edna_intake_bindings')->insert(['flow_send_id' => $send->id, 'case_id' => $send->request_id,
        'entry_event_id' => $first->id, 'state' => 'verified', 'lead_id' => '101',
        'proof' => json_encode($proof($first) + ['lead_id' => '101']), 'verified_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
    DB::table('edna_organic_menus')->where('id', $menu->id)->update(['available_at' => now(), 'enqueued_at' => null]);
    expect($service->process($menu->id))->toBe(['state' => 'preserved', 'reason' => 'paid_intake_session_preserved'])
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_organic_menus')->find($menu->id)->send_started_at)->toBeNull();
    Http::assertNothingSent();
});
