<?php

use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaFreshIntake;
use App\Services\EdnaIntake;
use App\Services\EdnaMessageBinding;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicLoan;
use App\Services\EdnaOrganicMenu;
use App\Services\EdnaOrganicProfile;
use App\Services\EdnaPaidEntry;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 26)->setTime(18, 0));
    config(['app.key' => 'base64:'.base64_encode(str_repeat('p', 32)), 'attribution.enabled' => true,
        'attribution.connection' => null, 'journey.enabled' => false, 'cache.default' => 'array',
        'edna' => ['enabled' => true, 'router_enabled' => true, 'subject_id' => '2423',
            'api_key' => 'local-test', 'cascade_id' => '2557', 'router_start_at' => now()->subDays(5)->toIso8601String(),
            'organic_menu_enabled' => true, 'organic_menu_start_at' => now()->subDays(5)->toIso8601String(),
            'intake_enabled' => true, 'intake_crm_enabled' => true, 'intake_flow_id' => '950118281197789',
            'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDays(5)->toIso8601String(),
            'intake_pilot_id' => 'paid-profile-test', 'intake_pilot_limit' => 'unlimited',
            'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/loan']]);
    DB::table('edna_intake_cutovers')->insert(['name' => EdnaFreshIntake::V3_VALIDITY,
        'entry_id_after' => 0, 'starts_at' => now()->subDay()]);
    Queue::fake();
    Http::preventStrayRequests();
    $bindings = Mockery::mock(EdnaMessageBinding::class);
    $proof = fn ($entry) => ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session',
        'evidence' => 'external_message_id', 'entry_event_id' => $entry->id, 'entry_message_id' => $entry->message_id,
        'chat_id' => '601', 'session_id' => '501', 'activity_id' => '701', 'message_id' => '801', 'native_lead_id' => '900'];
    $bindings->allows('resolveCurrent')->andReturnUsing($proof);
    $bindings->allows('resolveMenuHint')->andReturnUsing($proof);
    app()->instance(EdnaMessageBinding::class, $bindings);
    $this->attention = Mockery::mock(EdnaOrganicAttention::class);
    $this->attention->allows('inspectWelcome')->byDefault()->andReturn(['status' => 'ready', 'owner_id' => '74827', 'session_id' => '501']);
    $this->attention->allows('snapshot')->andReturn(['fingerprint' => str_repeat('a', 64), 'dialog_tuple' => ['bindings' => ['contact' => '901']]]);
    app()->instance(EdnaOrganicAttention::class, $this->attention);
    $this->profiles = Mockery::mock(EdnaOrganicProfile::class);
    $this->service = new EdnaOrganicLoan($this->profiles, $this->attention);
});

function paidProfileEvent(?array $content = null, ?string $received = null): array
{
    $messageId = (string) (93000 + DB::table('edna_incoming_events')->count());
    $payload = ['subjectId' => '2423', 'id' => $messageId, 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => $received ?? now()->toIso8601String(), 'messageContent' => $content
            ?? ['type' => 'TEXT', 'text' => 'Consulta del anuncio', 'referral' => ['source_type' => 'ad', 'source_id' => 'campaign-31']]];
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => $payload['subjectId'], 'message_id' => $messageId,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)), 'status' => 'delivered',
        'created_at' => now(), 'updated_at' => now()]);

    return [DB::table('edna_incoming_events')->find($id), $payload];
}

function paidProfileCapture(?array $content = null): object
{
    [$entry, $payload] = paidProfileEvent($content);
    expect((new EdnaIntake)->receiveEntry($entry, $payload))->toBeTrue();
    expect((new EdnaIntake)->receiveEntry($entry, $payload))->toBeTrue();

    return DB::table('edna_organic_menus')->where('entry_event_id', $entry->id)->firstOrFail();
}

test('fresh paid intake reuses one current profile for the actual attributed entry without a menu or a made-up choice', function (bool $tracked) {
    config(['edna.organic_menu_enabled' => false, 'edna.organic_menu_recipients' => ['another-recipient']]);
    $content = null;
    if ($tracked) {
        $touch = ['utm_source' => 'google', 'utm_medium' => 'cpc', 'at' => now()->subMinute()->toIso8601String()];
        $journey = (new AttributionJourney)->create(['version' => 1, 'first' => $touch, 'last' => $touch]);
        $content = ['type' => 'TEXT', 'text' => 'Consulta (ref: '.$journey->id.')'];
    }
    $receipt = paidProfileCapture($content);
    Queue::assertPushed(ProcessEdnaOrganicMenu::class, 1);
    expect(app(EdnaOrganicMenu::class)->process($receipt->id)['state'])->toBe('loan_pending');
    $this->profiles->expects('resolve')->once()->andReturn(['status' => 'reusable', 'answer' => ['cuil' => '20301234563'],
        'provenance' => ['source_kind' => 'web_form', 'source_id' => 'fixture']]);
    $this->profiles->expects('stillCurrent')->once()->andReturn(true);
    $this->service->prepare($receipt->id);
    $this->service->prepare($receipt->id);
    Http::fake(fn () => Http::response(['ok' => true, 'contract' => EdnaOrganicLoan::CONTRACT, 'case_id' => $receipt->request_id,
        'write_attempted' => true, 'action' => 'queued', 'lead_id' => '900']));
    $this->service->submit($receipt->id);
    $this->service->submit($receipt->id);
    $receipt = DB::table('edna_organic_menus')->find($receipt->id);
    expect($receipt->state)->toBe('loan_submitted')->and($receipt->choice)->toBeNull()->and($receipt->choice_event_id)->toBeNull()
        ->and($receipt->choice_received_at)->toBeNull()->and($receipt->outgoing_message_id)->toBeNull()
        ->and($receipt->flow_send_id)->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertSentCount(1);
    Http::assertSent(function ($request) use ($receipt, $tracked) {
        $body = $request->data();
        $marker = $body['attribution']['entry_routing'];
        expect($body['received_at'])->toEqual(now()->toIso8601String())->and($marker['entry_event_id'])->toBe($receipt->entry_event_id)
            ->and($marker['route'])->toBe('paid_profile_reuse')->and($body['attribution']['wa'])->not->toHaveKey('WA_FLOW_ID');
        if ($tracked) {
            expect($body['attribution']['status'])->toBe('resolved')->and($marker['evidence']['kind'])->toBe('tracked_paid_click')
                ->and($marker['evidence']['journey_id'])->toBe($body['attribution']['journey_id']);
        } else {
            expect($marker['evidence']['kind'])->toBe('provider_ad_referral')->and($marker['evidence']['source_id'])->toBe('campaign-31');
        }

        return true;
    });
})->with([true, false]);

test('paid fallback reserves a single real direct v3, and a human taking it before preparation wins', function (bool $taken) {
    $receipt = paidProfileCapture();
    expect(app(EdnaOrganicMenu::class)->process($receipt->id)['state'])->toBe('loan_pending');
    if ($taken) {
        $this->attention->expects('inspectWelcome')->andReturn(['status' => 'preserved', 'reason' => 'human_attention']);
    } else {
        $this->profiles->expects('resolve')->andReturn(['status' => 'missing', 'reason' => 'no_current_profile']);
    }
    $this->service->prepare($receipt->id);
    $this->service->prepare($receipt->id);
    $receipt = DB::table('edna_organic_menus')->find($receipt->id);
    expect($receipt->state)->toBe($taken ? 'preserved' : 'flow_scheduled')->and($receipt->choice_event_id)->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe($taken ? 0 : 1);
    if (! $taken) {
        Queue::assertPushed(SendEdnaFlow::class, 1);
        $send = DB::table('edna_flow_sends')->find($receipt->flow_send_id);
        $snapshot = json_decode(Crypt::decryptString($send->attribution_snapshot), true);
        expect($snapshot['entry_routing'])->toBe(json_decode($receipt->paid_entry_routing, true));
    }
    Http::assertNothingSent();
})->with([true, false]);

test('the preactivation paid entry keeps its direct v3 reservation even when processed after the cutoff', function () {
    [$entry, $payload] = paidProfileEvent(null, now()->subMinutes(5)->toIso8601String());
    DB::table('edna_intake_cutovers')->update(['starts_at' => now()->subMinute()]);
    expect((new EdnaIntake)->receiveEntry($entry, $payload))->toBeTrue()
        ->and(DB::table('edna_flow_sends')->count())->toBe(1)->and(DB::table('edna_organic_menus')->count())->toBe(0);
});

test('a distinct paid entry renews an expired same-session request once, without renewing it for a casual followup', function (string $original) {
    $previous = paidProfileCapture();
    expect(app(EdnaOrganicMenu::class)->process($previous->id)['state'])->toBe('loan_pending');
    $this->profiles->allows('resolve')->andReturn(['status' => 'missing', 'reason' => 'no_current_profile']);
    $this->service->prepare($previous->id);
    DB::table('edna_flow_sends')->update(['state' => $original === 'unknown' ? 'unknown' : 'confirmed']);
    if ($original === 'historical-preserved') {
        // Historical receipt of a selected loan whose send was blocked by another previous v3.
        DB::table('edna_organic_menus')->where('id', $previous->id)->update([
            'send_state' => 'confirmed', 'paid_entry_routing' => null, 'choice' => 'loan', 'choice_received_at' => now(),
            'flow_send_id' => null, 'state' => 'preserved', 'reason' => 'existing_flow_or_context_preserved',
        ]);
    }
    $this->travel(25)->hours();
    $casual = paidProfileCapture(['type' => 'TEXT', 'text' => 'Hola']);
    expect(app(EdnaOrganicMenu::class)->process($casual->id)['state'])->toBe('duplicate');
    $new = paidProfileCapture();
    if ($original === 'unknown') {
        expect(app(EdnaOrganicMenu::class)->process($new->id)['state'])->toBe('duplicate')
            ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    } else {
        expect(app(EdnaOrganicMenu::class)->process($new->id)['state'])->toBe('loan_pending');
        $second = paidProfileCapture();
        expect(app(EdnaOrganicMenu::class)->process($second->id)['state'])->toBe('duplicate');
        $this->service->prepare($new->id);
        $this->service->prepare($new->id);
        $renewed = DB::table('edna_organic_menus')->find($new->id);
        expect($renewed->state)->toBe('flow_scheduled')->and($renewed->request_generation)->toBe(1)
            ->and($renewed->chat_id)->toBe(601)->and($renewed->session_id)->toBe(501)
            ->and(DB::table('edna_flow_sends')->count())->toBe(2);
    }
    Http::assertNothingSent();
})->with(['confirmed', 'unknown', 'historical-preserved']);

test('an unchosen greeting yields to a later paid entry and a worker restart keeps that generation', function () {
    $old = paidProfileCapture(['type' => 'TEXT', 'text' => 'Hola']);
    DB::table('edna_organic_menus')->where('id', $old->id)->update(['send_state' => 'confirmed',
        'state' => 'awaiting_choice', 'chat_id' => '601', 'session_id' => '501', 'send_started_at' => now()]);
    $this->travel(2)->minutes();
    $new = paidProfileCapture();
    expect(app(EdnaOrganicMenu::class)->process($new->id)['state'])->toBe('loan_pending')
        ->and(DB::table('edna_organic_menus')->find($old->id)->reason)->toBe('new_paid_entry_took_precedence');
    // Retry after the session has been claimed, before the asynchronous loan preparation.
    DB::table('edna_organic_menus')->where('id', $new->id)->update(['state' => 'waiting', 'available_at' => now()]);
    expect(app(EdnaOrganicMenu::class)->process($new->id)['state'])->toBe('loan_pending')
        ->and(DB::table('edna_organic_menus')->find($new->id)->request_generation)->toBe(1);
});

test('a recipient outside the paid pilot records why the paid entry did not proceed', function () {
    config(['edna.router_recipients' => ['another-recipient']]);
    [$event, $payload] = paidProfileEvent();
    expect((new EdnaIntake)->receiveEntry($event, $payload))->toBeTrue()
        ->and(DB::table('edna_incoming_events')->find($event->id)->router_action)->toBe('paid_profile_intake_ineligible')
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)->and(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('an actionable v3 and reusable profile share one recipient claim even for entries from two different chats', function (bool $formFirst) {
    $receipt = paidProfileCapture();
    expect(app(EdnaOrganicMenu::class)->process($receipt->id)['state'])->toBe('loan_pending');
    $this->profiles->expects('resolve')->andReturn(['status' => 'reusable', 'answer' => ['cuil' => '20301234563'],
        'provenance' => ['source_kind' => 'web_form', 'source_id' => 'fixture']]);
    $this->profiles->expects('stillCurrent')->andReturn(true);
    $this->service->prepare($receipt->id);
    [$other, $payload] = paidProfileEvent();
    $reserve = fn () => (new EdnaFlowRouter)->startPaidEntry($other, $payload, (new EdnaPaidEntry)->classify($other, $payload));
    if ($formFirst) {
        $id = $reserve();
        expect($id)->toBeInt();
        DB::table('edna_flow_sends')->where('id', $id)->update(['state' => 'confirmed']);
        $this->service->submit($receipt->id);
        expect(DB::table('edna_organic_menus')->find($receipt->id)->reason)->toBe('existing_flow_or_context_preserved')
            ->and(DB::table('edna_flow_sends')->count())->toBe(1);
        Http::assertNothingSent();
    } else {
        Http::fake(function () use ($receipt, $reserve) {
            // Interleave the competing callback after the CRM claim has committed, but before its acknowledgement.
            expect(DB::table('edna_organic_menus')->find($receipt->id)->state)->toBe('submitting');
            expect($reserve())->toBeNull();

            return Http::response(['ok' => true, 'contract' => EdnaOrganicLoan::CONTRACT, 'case_id' => $receipt->request_id,
                'write_attempted' => true, 'action' => 'queued', 'lead_id' => '900']);
        });
        $this->service->submit($receipt->id);
        expect(DB::table('edna_organic_menus')->find($receipt->id)->state)->toBe('loan_submitted');
        expect($reserve())->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(0);
        Http::assertSentCount(1);
    }
})->with([true, false]);
