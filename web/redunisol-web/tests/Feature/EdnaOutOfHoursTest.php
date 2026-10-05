<?php

use App\Filament\Pages\WhatsAppOutOfHoursPage;
use App\Filament\Resources\WhatsAppNotices\Pages\ListWhatsAppNotices;
use App\Jobs\EvaluateEdnaOutOfHours;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaOutOfHours;
use App\Jobs\SendEdnaOutOfHours;
use App\Models\EdnaOutOfHoursSend;
use App\Models\User;
use App\Services\AttributionJourney;
use App\Services\EdnaOutOfHours;
use App\Services\WhatsAppSalesContext;
use App\Support\WhatsAppOutOfHoursSettings;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-10-05T22:00:00-03:00')->utc());
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('edna', ['enabled' => true, 'out_of_hours_enabled' => true,
        'out_of_hours_recipients' => [], 'subject_id' => '2423', 'cascade_id' => '2557',
        'api_key' => 'test-key', 'bitrix_url' => 'https://redunisol.bitrix24.es/rest/1/testkey/',
        'kestra_url' => 'https://kestra.example.test/webhook/test']);
    $settings = new WhatsAppOutOfHoursSettings;
    $settings->save(array_replace($settings->defaults(), ['enabled' => true]));
    Http::preventStrayRequests();
});

function offHoursEvent(array $overrides = [], bool $candidate = true): array
{
    $payload = array_replace_recursive(['subscriber' => ['identifier' => '5493511234567'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Hola']], $overrides);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423',
        'message_id' => (string) (2000 + DB::table('edna_incoming_events')->count()),
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered',
        'out_of_hours_candidate' => $candidate, 'created_at' => now(), 'updated_at' => now()]);

    return [DB::table('edna_incoming_events')->find($id), $payload];
}

function offHoursReserve(array $overrides = []): EdnaOutOfHoursSend
{
    [$event, $payload] = offHoursEvent($overrides);
    (new EdnaOutOfHours)->reserve($event, $payload,
        ['managed' => true, 'name' => 'Ana', 'advisor_name' => 'Maru', 'advisor_id' => 57],
        (new WhatsAppOutOfHoursSettings)->get());

    return EdnaOutOfHoursSend::latest('id')->first();
}

function offHoursHttp(int &$posts, bool $timeout = false, string $rule = 'none', bool $historyMatches = true): void
{
    Http::fake([
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
            'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'redunisol.bitrix24.es/*' => Http::response(['result' => ['ID' => '1', 'WORKTIME_DAYOFF_RULE' => $rule]]),
        'app.edna.io/api/cascade/schedule' => function ($r) use (&$posts, $timeout) {
            $posts++;
            if ($timeout) {
                throw new ConnectionException('private transport content');
            }

            return Http::response(['requestId' => $r['requestId']]);
        },
        'app.edna.io/api/messages/history' => function () use ($historyMatches) {
            $send = EdnaOutOfHoursSend::first();

            return Http::response(['hasNext' => false, 'content' => [[
                'messageId' => 999, 'comment' => $send->request_id, 'direction' => 'OUT', 'channelType' => 'WHATSAPP',
                'subjectId' => 2423, 'cascadeId' => 2557, 'address' => $historyMatches ? $send->recipient : '5493519999999',
                'content' => ['type' => 'TEXT', 'text' => $send->message_text], 'deliveryStatus' => 'DELIVERED',
            ]]]);
        },
    ]);
}

test('calendar respects boundaries, weekends and holidays in Cordoba timezone', function (string $time, ?string $next) {
    $settings = new WhatsAppOutOfHoursSettings;
    $data = $settings->get();
    $data['holidays'] = ['2026-10-12'];
    $window = $settings->window(CarbonImmutable::parse($time), $data);
    expect($window ? $window['end']->setTimezone($data['timezone'])->format('Y-m-d H:i') : null)->toBe($next);
})->with([
    ['2026-10-05T08:59:59-03:00', '2026-10-05 09:00'],
    ['2026-10-05T09:00:00-03:00', null], ['2026-10-05T16:59:59-03:00', null],
    ['2026-10-05T17:00:00-03:00', '2026-10-06 09:00'],
    ['2026-10-09T22:00:00-03:00', '2026-10-13 09:00'],
    ['2026-10-10T12:00:00-03:00', '2026-10-13 09:00'],
    ['2026-10-12T12:00:00-03:00', '2026-10-13 09:00'],
]);

test('three messages reserve one notice in the continuous closed interval', function () {
    $service = new EdnaOutOfHours;
    foreach (range(1, 3) as $i) {
        [$event, $payload] = offHoursEvent();
        $service->reserve($event, $payload, ['managed' => false], (new WhatsAppOutOfHoursSettings)->get());
    }
    expect(EdnaOutOfHoursSend::count())->toBe(1)->and(DB::table('jobs')->count())->toBe(1);
    $raw = DB::table('edna_out_of_hours_sends')->first();
    expect($raw->recipient)->not->toContain('5493511234567')->and($raw->message_text)->not->toContain('Recibimos');
    expect(DB::table('jobs')->first()->payload)->not->toContain('5493511234567', 'Recibimos');
});

test('calendar changes do not reserve a second notice for an overlapping closed interval', function () {
    offHoursReserve();
    $settings = new WhatsAppOutOfHoursSettings;
    $data = $settings->get();
    $data['holidays'] = ['2026-10-06'];
    $settings->save($data);
    offHoursReserve();
    expect(EdnaOutOfHoursSend::count())->toBe(1);
});

test('a new closed interval allows a new notice', function () {
    offHoursReserve();
    $this->travel(24)->hours();
    offHoursReserve();
    expect(EdnaOutOfHoursSend::count())->toBe(2);
});

test('disabled pilot, old messages and future timestamps cannot reserve notices', function (string $case) {
    $override = [];
    if ($case === 'disabled') {
        config()->set('edna.out_of_hours_enabled', false);
    }
    if ($case === 'pilot') {
        config()->set('edna.out_of_hours_recipients', ['5493510000000']);
    }
    if ($case === 'old') {
        $override['receivedAt'] = now()->subDays(2)->toIso8601String();
    }
    if ($case === 'future') {
        $override['receivedAt'] = now()->addHour()->toIso8601String();
    }
    if ($case === 'before_activation') {
        $override['receivedAt'] = now()->subMinute()->toIso8601String();
    }
    [$event, $payload] = offHoursEvent($override);
    expect((new EdnaOutOfHours)->eligible($event, $payload, (new WhatsAppOutOfHoursSettings)->get()))->toBeNull();
})->with(['disabled', 'pilot', 'old', 'future', 'before_activation']);

test('in-hours messages and a previous closed interval cannot be sent after opening', function () {
    [$event, $payload] = offHoursEvent();
    $this->travelTo(CarbonImmutable::parse('2026-10-06T10:00:00-03:00')->utc());
    expect((new EdnaOutOfHours)->eligible($event, $payload, (new WhatsAppOutOfHoursSettings)->get()))->toBeNull();
});

test('missing names use grammatical defaults and configured texts apply without deploy', function () {
    $settings = new WhatsAppOutOfHoursSettings;
    $data = $settings->get();
    $window = $settings->window(CarbonImmutable::now());
    $text = $settings->render('managed', [], $window, $data);
    expect($text)->toContain('Un asesor', '06/10', '09:00')->not->toContain('{', 'www.', 'http');
    $data['general_text'] = 'Mensaje recibido. Respondemos {proxima_apertura}.';
    $settings->save($data);
    expect($settings->render('general', [], $window, $settings->get()))->toStartWith('Mensaje recibido.');
});

test('links and unknown placeholders are rejected before persistence', function (string $text) {
    $settings = new WhatsAppOutOfHoursSettings;
    $data = $settings->get();
    $data['general_text'] = $text;
    expect(fn () => $settings->save($data))->toThrow(ValidationException::class);
})->with(['Visita www.redunisol.com.ar', 'https://redunisol.com.ar', 'redunisol.com.ar', '[url=x]web[/url]', 'Hola {desconocido}']);

test('calendar validates closing time and holiday dates', function (array $invalid) {
    $settings = new WhatsAppOutOfHoursSettings;
    expect(fn () => $settings->save(array_replace($settings->get(), $invalid)))->toThrow(ValidationException::class);
})->with([[['open' => '17:00', 'close' => '09:00']], [['weekdays' => []]], [['holidays' => ['2026-02-30']]]]);

test('pending automated Flow suppresses ordinary replies before any CRM query', function () {
    $send = offHoursReserve();
    DB::table('edna_flow_sends')->insert(['scope' => $send->scope, 'request_id' => 'router-test', 'entry_event_id' => 999,
        'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => '1850162769693486', 'recipient' => Crypt::encryptString($send->recipient),
        'state' => 'confirmed', 'entry_received_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
    $posts = 0;
    offHoursHttp($posts);
    (new SendEdnaOutOfHours($send->id))->handle();
    expect($send->fresh()->state)->toBe('cancelled')->and($posts)->toBe(0);
});

test('sender performs one POST and verifies the exact notice in history', function () {
    $send = offHoursReserve();
    $posts = 0;
    offHoursHttp($posts);
    $job = new SendEdnaOutOfHours($send->id);
    $job->handle();
    $job->handle();
    expect($send->fresh()->state.':'.$send->fresh()->reason)->toBe('accepted:');
    expect($posts)->toBe(1);
    (new ReconcileEdnaOutOfHours($send->id))->handle();
    expect($send->fresh()->state)->toBe('confirmed')->and($send->fresh()->outgoing_message_id)->toBe('999');
    Http::assertSent(fn ($r) => str_contains($r->url(), 'cascade/schedule')
        && $r['content']['whatsappContent']['text'] === $send->message_text);
});

test('timeout is reconciled by history without repeating the POST', function () {
    $send = offHoursReserve();
    $posts = 0;
    offHoursHttp($posts, true);
    $job = new SendEdnaOutOfHours($send->id);
    $job->handle();
    $job->handle();
    expect($posts)->toBe(1)->and($send->fresh()->state)->toBe('unknown');
    (new ReconcileEdnaOutOfHours($send->id))->handle();
    expect($send->fresh()->state)->toBe('confirmed');
});

test('mismatched outgoing history never confirms the notice', function () {
    $send = offHoursReserve();
    $posts = 0;
    offHoursHttp($posts, false, 'none', false);
    (new SendEdnaOutOfHours($send->id))->handle();
    expect(fn () => (new ReconcileEdnaOutOfHours($send->id))->handle())->toThrow(RuntimeException::class);
    expect($send->fresh()->state)->toBe('accepted');
});

test('active Bitrix reply blocks sending and errors never expose private text', function () {
    $send = offHoursReserve();
    $posts = 0;
    offHoursHttp($posts, false, 'text');
    expect(fn () => (new SendEdnaOutOfHours($send->id))->handle())->toThrow(RuntimeException::class,
        'Out of hours send unconfirmed; inspect the send ID.');
    expect($posts)->toBe(0)->and($send->fresh()->state)->toBe('pending');
});

test('worker crash after the claim is recovered without repeating the POST', function () {
    $send = offHoursReserve();
    $send->update(['state' => 'sending', 'send_started_at' => now()]);
    $posts = 0;
    offHoursHttp($posts);
    (new SendEdnaOutOfHours($send->id))->handle();
    (new ReconcileEdnaOutOfHours($send->id))->handle();
    expect($posts)->toBe(0)->and($send->fresh()->state)->toBe('confirmed');
});

test('disabled settings and expired windows cancel a pending notice', function (string $case) {
    $send = offHoursReserve();
    if ($case === 'disabled') {
        config()->set('edna.out_of_hours_enabled', false);
    } else {
        $this->travelTo(CarbonImmutable::parse('2026-10-06T09:00:00-03:00')->utc());
    }
    $posts = 0;
    offHoursHttp($posts);
    (new SendEdnaOutOfHours($send->id))->handle();
    expect($posts)->toBe(0)->and($send->fresh()->state)->toBe('cancelled');
})->with(['disabled', 'expired']);

test('Kestra candidate acknowledgement durably queues evaluation and legacy responses do not', function (bool $candidate) {
    [$event] = offHoursEvent();
    DB::table('edna_incoming_events')->where('id', $event->id)->update(['status' => 'pending']);
    $result = ['ok' => true, 'event_key' => '2423:'.$event->message_id, 'kind' => 'ignored'];
    if ($candidate) {
        $result['out_of_hours_candidate'] = true;
    }
    Http::fake(['kestra.example.test/*' => Http::response($result)]);
    (new ReceiveEdnaInKestra($event->id))->handle();
    expect((bool) DB::table('edna_incoming_events')->find($event->id)->out_of_hours_candidate)->toBe($candidate);
    expect(DB::table('jobs')->count())->toBe($candidate ? 1 : 0);
})->with([true, false]);

test('evaluation failure can retry without losing the incoming message', function () {
    [$event] = offHoursEvent();
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andThrow(new RuntimeException('private phone'));
    expect(fn () => (new EvaluateEdnaOutOfHours($event->id))->handle())->toThrow(RuntimeException::class,
        'Out of hours evaluation failed; inspect the event ID.');
    expect(DB::table('edna_incoming_events')->find($event->id)->status)->toBe('delivered');
});

test('retention removes closed notice PII and preserves uncertain sends', function () {
    $send = offHoursReserve();
    $send->update(['state' => 'confirmed', 'created_at' => now()->subDays(31)]);
    $this->travel(24)->hours();
    $uncertain = offHoursReserve();
    $uncertain->update(['state' => 'unknown', 'created_at' => now()->subDays(31)]);
    $this->artisan('edna:out-of-hours prune --apply')->assertSuccessful();
    expect($send->fresh()->recipient)->toBeNull()->and($send->fresh()->message_text)->toBeNull()
        ->and($uncertain->fresh()->recipient)->not->toBeNull();
});

test('Marketing can save settings and inspect masked notice records in the existing panel', function () {
    $this->actingAs(User::factory()->create(['email' => 'admin@redunisol.local']));
    $page = Livewire::test(WhatsAppOutOfHoursPage::class)->assertSuccessful();
    $page->fillForm(['general_text' => 'Recibimos tu consulta. Respondemos {proxima_apertura}.'])->call('save')->assertHasNoFormErrors();
    expect((new WhatsAppOutOfHoursSettings)->get()['general_text'])->toStartWith('Recibimos tu consulta.');
    $send = offHoursReserve();
    Livewire::test(ListWhatsAppNotices::class)->assertSuccessful()->assertCanSeeTableRecords([$send])
        ->assertDontSee('5493511234567');
});

test('evaluation is idempotent and reserves the correct managed notice', function () {
    [$event] = offHoursEvent();
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturn([
        'managed' => true, 'name' => 'Ana', 'advisor_name' => 'Maru', 'advisor_id' => 57,
    ]);
    $job = new EvaluateEdnaOutOfHours($event->id);
    $job->handle();
    $job->handle();
    expect(EdnaOutOfHoursSend::count())->toBe(1)->and(EdnaOutOfHoursSend::first()->notice_type)->toBe('managed')
        ->and(EdnaOutOfHoursSend::first()->message_text)->toContain('Ana', 'Maru');
    expect(DB::table('edna_incoming_events')->find($event->id)->out_of_hours_evaluated_at)->not->toBeNull();
});

test('scheduler can recover an evaluation that failed before reserving a notice', function () {
    [$event] = offHoursEvent();
    DB::table('edna_incoming_events')->where('id', $event->id)->update([
        'updated_at' => now()->subMinutes(10), 'delivered_at' => now()->subMinutes(10),
    ]);
    $this->artisan('edna:out-of-hours recover --apply')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(1);
    $this->artisan('edna:out-of-hours recover --apply')->assertSuccessful();
    expect(DB::table('jobs')->count())->toBe(1);
});

test('reply to an advisor-sent form link suppresses the informational notice', function () {
    [$event, $payload] = offHoursEvent(['replyOutMessageExternalRequestId' => 'form-request']);
    $hash = (new AttributionJourney)->phoneHash($payload['subscriber']['identifier']);
    DB::table('edna_form_link_sends')->insert(['scope' => hash('sha256', '2423:'.$hash),
        'entry_event_id' => 888, 'request_id' => 'form-request', 'subject_id' => '2423', 'cascade_id' => '2557',
        'crm_entity' => 'contact', 'crm_id' => '123', 'state' => 'confirmed', 'created_at' => now(), 'updated_at' => now()]);
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeTrue();
    $payload['subscriber']['identifier'] = '5493519999999';
    expect((new EdnaOutOfHours)->automaticRoute($event, $payload))->toBeFalse();
});

test('report exposes counts without customer identity data', function () {
    offHoursReserve();
    $this->artisan('edna:out-of-hours report')->expectsOutputToContain('managed')->assertSuccessful();
});
