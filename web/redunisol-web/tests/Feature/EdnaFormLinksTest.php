<?php

use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaFormLink;
use App\Jobs\SendEdnaFormLink;
use App\Jobs\SyncEdnaFormLink;
use App\Services\AttributionJourney;
use App\Services\EdnaFormLink;
use App\Services\EdnaFormRequest;
use App\Services\EdnaFormTemplate;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 10, 1)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('attribution.enabled', true);
    config()->set('edna', ['enabled' => true, 'form_links_enabled' => true, 'form_link_send_enabled' => true,
        'subject_id' => '2423', 'cascade_id' => '2557', 'api_key' => 'test-key',
        'router_start_at' => now()->subHour()->toIso8601String(), 'form_link_recipients' => [],
        'bitrix_url' => 'https://redunisol.bitrix24.es/rest/1/testkey/']);
    Http::preventStrayRequests();
});

function formLinkCapture(string $text, string $kind = 'router_entry', array $overrides = []): object
{
    $payload = array_replace_recursive(['subscriber' => ['identifier' => '5493511234567'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => $text]], $overrides);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423',
        'message_id' => (string) (1000 + DB::table('edna_incoming_events')->count()),
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered',
        'created_at' => now(), 'updated_at' => now()]);
    DB::transaction(fn () => (new EdnaFormLink)->capture((object) ['id' => $id, 'subject_id' => '2423'], $payload, $kind));

    return DB::table('edna_form_links')->first() ?? (object) [];
}

function formLinkJourney(): object
{
    return (new AttributionJourney)->touch(Request::create('https://redunisol.com.ar/?utm_source=meta&utm_campaign=cordoba'));
}

function formLinkHttp(array &$record, bool $timeout = false, ?int &$attempts = null, string $templateStatus = 'APPROVED'): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake([
        'redunisol.bitrix24.es/*' => function ($r) use (&$record) {
            $method = basename($r->url(), '.json');
            $result = match ($method) {
                'crm.contact.fields', 'crm.lead.fields' => [
                    EdnaFormLink::CRM_FIELD => ['type' => 'string'], EdnaFormLink::SEND_FIELD => ['type' => 'boolean'],
                    EdnaFormLink::STATUS_FIELD => ['type' => 'string'],
                ],
                'crm.duplicate.findbycomm' => ['CONTACT' => ['123']],
                'crm.contact.get' => $record,
                'crm.contact.list' => ! empty($record[EdnaFormLink::SEND_FIELD]) ? [['ID' => '123']] : [],
                'crm.lead.list' => [],
                'crm.contact.update' => true,
                default => throw new RuntimeException('Unexpected CRM method '.$method),
            };
            if ($method === 'crm.contact.update') {
                $record = array_replace($record, $r['fields']);
            }

            return Http::response(['result' => $result]);
        },
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
            'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/message-matchers/get-by-request' => fn () => Http::response([
            (new EdnaFormTemplate)->definition() + ['id' => 123, 'status' => $templateStatus, 'locked' => false],
        ]),
        'app.edna.io/api/cascade/schedule' => function ($r) use ($timeout, &$attempts) {
            $attempts = ($attempts ?? 0) + 1;
            if ($timeout) {
                throw new ConnectionException('private transport content');
            }

            return Http::response(['requestId' => $r['requestId']]);
        },
        'app.edna.io/api/messages/history' => function () {
            $send = DB::table('edna_form_link_sends')->first();
            $content = json_decode($send->content, true);

            return Http::response(['hasNext' => false, 'content' => [[
                'messageId' => '999', 'comment' => $send->request_id, 'direction' => 'OUT', 'channelType' => 'WHATSAPP',
                'subjectId' => '2423', 'cascadeId' => '2557', 'address' => '5493511234567',
                'content' => ['type' => 'TEXT', 'text' => $content['text']], 'deliveryStatus' => 'DELIVERED',
            ]]]);
        },
    ]);
}

function formLinkRecord(): array
{
    return ['ID' => '123', 'PHONE' => [['VALUE' => '+54 351 1234567']], 'UTM_SOURCE' => 'historic',
        'UF_CRM_JOURNEY_ID' => 'historical', EdnaFormLink::SEND_FIELD => 0];
}

function formLinkReady(array &$record): object
{
    $journey = formLinkJourney();
    $context = formLinkCapture('Hola (ref: '.$journey->id.')');
    formLinkHttp($record);
    (new SyncEdnaFormLink($context->scope, $context->entry_event_id))->handle();
    $record[EdnaFormLink::SEND_FIELD] = 1;
    (new EdnaFormRequest)->poll();

    return DB::table('edna_form_link_sends')->first();
}

test('a verified entry publishes the current link before the Flow is completed', function () {
    $journey = formLinkJourney();
    $context = formLinkCapture('Hola (ref: '.$journey->id.')');
    expect((new EdnaFormLink)->url($context))->toBe(EdnaFormLink::HOME.'?ref='.$journey->id);
    expect(DB::table('edna_flow_sends')->count())->toBe(0);
    $record = formLinkRecord();
    formLinkHttp($record);
    $job = new SyncEdnaFormLink($context->scope, $context->entry_event_id);
    $job->handle();
    $job->handle();
    expect($record[EdnaFormLink::CRM_FIELD])->toContain($journey->id)
        ->and($record['UTM_SOURCE'])->toBe('historic')->and($record['UF_CRM_JOURNEY_ID'])->toBe('historical');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
    expect(DB::table('jobs')->pluck('payload')->implode(''))->not->toContain('5493511234567', 'cordoba');
});

test('a new entry without a reference clears the previous campaign and send intent', function () {
    $journey = formLinkJourney();
    $old = formLinkCapture('(ref: '.$journey->id.')');
    $record = formLinkRecord();
    formLinkHttp($record);
    (new SyncEdnaFormLink($old->scope, $old->entry_event_id))->handle();
    $record[EdnaFormLink::SEND_FIELD] = 1;
    $current = formLinkCapture('Hola, vengo del sitio web de Red Unisol.');
    (new SyncEdnaFormLink($current->scope, $current->entry_event_id))->handle();
    (new SyncEdnaFormLink($old->scope, $old->entry_event_id))->handle();
    expect($record[EdnaFormLink::CRM_FIELD])->toBe(EdnaFormLink::HOME)
        ->and($record[EdnaFormLink::SEND_FIELD])->toBe(0);
});

test('ordinary replies keep the current reference but never recover it after a day', function () {
    $journey = formLinkJourney();
    formLinkCapture('(ref: '.$journey->id.')');
    $reply = formLinkCapture('Gracias', 'ignored');
    expect($reply->journey_id)->toBe($journey->id);
    $this->travel(25)->hours();
    $new = formLinkCapture('Hola', 'ignored');
    expect($new->journey_id)->toBeNull();
});

test('late events cannot overwrite a newer conversation', function () {
    formLinkCapture('Sin referencia');
    $journey = formLinkJourney();
    $current = formLinkCapture('(ref: '.$journey->id.')');
    $late = formLinkCapture('Viejo', 'router_entry', ['receivedAt' => now()->subMinute()->toIso8601String()]);
    expect($late->entry_event_id)->toBe($current->entry_event_id)->and($late->journey_id)->toBe($journey->id);
});

test('an expired or mismatched reference falls back without inventing acquisition', function (string $case) {
    $journey = formLinkJourney();
    if ($case === 'other_phone') {
        (new AttributionJourney)->bind('(ref: '.$journey->id.')', '5493517654321', '2423');
    } else {
        DB::table('attribution_journeys')->where('id', $journey->id)->update(['expires_at' => now()->subMinute()]);
    }
    $context = formLinkCapture('(ref: '.$journey->id.')');
    expect((new EdnaFormLink)->url($context))->toBe(EdnaFormLink::HOME);
})->with(['expired', 'other_phone']);

test('disabled, historical and future captures do nothing', function (string $case) {
    $overrides = [];
    match ($case) {
        'disabled' => config()->set('edna.form_links_enabled', false),
        'historic' => $overrides = ['receivedAt' => now()->subHours(2)->toIso8601String()],
        'future' => $overrides = ['receivedAt' => now()->addMinutes(6)->toIso8601String()],
    };
    formLinkCapture('Hola', 'router_entry', $overrides);
    expect(DB::table('edna_form_links')->count())->toBe(0);
})->with(['disabled', 'historic', 'future']);

test('the pilot preserves other customer links but rejects their send requests without consuming a send', function () {
    config()->set('edna.form_link_recipients', ['5493519999999']);
    $journey = formLinkJourney();
    $context = formLinkCapture('(ref: '.$journey->id.')');
    $record = formLinkRecord();
    formLinkHttp($record);
    (new SyncEdnaFormLink($context->scope, $context->entry_event_id))->handle();
    expect($record[EdnaFormLink::CRM_FIELD])->toBe(EdnaFormLink::HOME.'?ref='.$journey->id)
        ->and($record[EdnaFormLink::STATUS_FIELD])->toBe('Envío no habilitado; podés copiar el enlace.');
    $record[EdnaFormLink::SEND_FIELD] = 1;
    (new EdnaFormRequest)->poll();
    expect(DB::table('edna_form_link_sends')->count())->toBe(0)
        ->and($record[EdnaFormLink::SEND_FIELD])->toBe(0);
    expect(DB::table('jobs')->pluck('payload')->implode(''))->not->toContain('SendEdnaFormLink');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));

    $current = formLinkCapture('Hola, vengo del sitio web de Red Unisol.');
    (new SyncEdnaFormLink($current->scope, $current->entry_event_id))->handle();
    expect($record[EdnaFormLink::CRM_FIELD])->toBe(EdnaFormLink::HOME)
        ->and(DB::table('edna_form_links')->first()->journey_id)->toBeNull();

    config()->set('edna.form_link_recipients', ['5493511234567']);
    $record[EdnaFormLink::SEND_FIELD] = 1;
    (new EdnaFormRequest)->poll();
    expect(DB::table('edna_form_link_sends')->count())->toBe(1);
});

test('explicit CRM action sends one dynamic button and repeated polling never duplicates it', function () {
    config()->set('edna.form_link_recipients', ['5493511234567']);
    $record = formLinkRecord();
    $send = formLinkReady($record);
    (new EdnaFormRequest)->poll();
    (new SendEdnaFormLink($send->id))->handle();
    (new SendEdnaFormLink($send->id))->handle();
    (new ReconcileEdnaFormLink($send->id))->handle();
    $record[EdnaFormLink::SEND_FIELD] = 1;
    (new EdnaFormRequest)->poll();
    $send = DB::table('edna_form_link_sends')->first();
    expect(DB::table('edna_form_link_sends')->count())->toBe(1)->and($send->state)->toBe('confirmed');
    expect($record[EdnaFormLink::SEND_FIELD])->toBe(0)->and($record[EdnaFormLink::STATUS_FIELD])->toBe('Enviado por WhatsApp.');
    Http::assertSent(fn ($r) => str_contains($r->url(), 'cascade/schedule')
        && $r['content']['whatsappContent']['keyboard']['rows'][0]['buttons'][0]['urlPostfix'] === '?ref='.$send->journey_id);
    expect(Http::recorded(fn ($r) => str_contains($r->url(), 'cascade/schedule')))->toHaveCount(1);
});

test('timeouts preserve uncertainty and are reconciled without a second send', function () {
    $record = formLinkRecord();
    $send = formLinkReady($record);
    $attempts = 0;
    formLinkHttp($record, true, $attempts);
    (new SendEdnaFormLink($send->id))->handle();
    expect(DB::table('edna_form_link_sends')->first()->state)->toBe('unknown');
    (new SendEdnaFormLink($send->id))->handle();
    (new ReconcileEdnaFormLink($send->id))->handle();
    expect(DB::table('edna_form_link_sends')->first()->state)->toBe('confirmed');
    expect($attempts)->toBe(1);
});

test('a queued action is cancelled if its recipient, intent, context or activation changes', function (string $case) {
    $record = formLinkRecord();
    $send = formLinkReady($record);
    match ($case) {
        'phone' => $record['PHONE'] = [['VALUE' => '5493517654321']],
        'intent' => $record[EdnaFormLink::SEND_FIELD] = 0,
        'context' => formLinkCapture('Nueva consulta'),
        'disabled' => config()->set('edna.form_link_send_enabled', false),
        'pilot' => config()->set('edna.form_link_recipients', ['5493519999999']),
        'expired' => $this->travel(24)->hours(),
    };
    (new SendEdnaFormLink($send->id))->handle();
    expect(DB::table('edna_form_link_sends')->first()->state)->toBe('cancelled');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
})->with(['phone', 'intent', 'context', 'disabled', 'pilot', 'expired']);

test('a request without a current identified context does not use CRM historical journey', function () {
    $record = formLinkRecord();
    $record[EdnaFormLink::SEND_FIELD] = 1;
    formLinkHttp($record);
    (new EdnaFormRequest)->poll();
    expect(DB::table('edna_form_link_sends')->count())->toBe(0)
        ->and($record[EdnaFormLink::STATUS_FIELD])->toContain('No enviado');
});

test('form submission in another browser restores the campaign carried by the advisor link', function () {
    $journey = formLinkJourney();
    $context = formLinkCapture('(ref: '.$journey->id.')');
    parse_str(parse_url((new EdnaFormLink)->url($context), PHP_URL_QUERY), $query);
    $input = (new AttributionJourney)->resolveForm(Request::create('/'), $query + ['celular' => '3511234567']);
    expect($input['utm_source'])->toBe('meta')->and($input['utm_campaign'])->toBe('cordoba')
        ->and($input['attribution']['wa_assisted'])->toBeTrue();
});

test('ambiguous CRM contacts are left for review without updating any record', function () {
    $context = formLinkCapture('(ref: '.formLinkJourney()->id.')');
    Http::fake(['redunisol.bitrix24.es/*' => Http::response(['result' => ['CONTACT' => ['123', '456']]])]);
    (new SyncEdnaFormLink($context->scope, $context->entry_event_id))->handle();
    expect(DB::table('edna_form_links')->first()->crm_reason)->toBe('ambiguous_contact');
    Http::assertSentCount(1);
});

test('template registration uses the provider contract and never schedules a message', function () {
    $created = false;
    Http::fake([
        'app.edna.io/api/message-matchers/get-by-request' => function () use (&$created) {
            return Http::response($created ? [(new EdnaFormTemplate)->definition() + ['id' => 1, 'status' => 'PENDING']] : []);
        },
        'app.edna.io/api/message-matchers' => function ($r) use (&$created) {
            expect($r['subjectIds'])->toBe([2423]);
            expect($r['messageMatcher'])->not->toHaveKey('subjectIds');
            $created = true;

            return Http::response(['id' => 1, 'status' => 'PENDING']);
        },
    ]);
    expect((new EdnaFormTemplate)->inspect(true)['status'])->toBe('PENDING');
    (new EdnaFormTemplate)->inspect(true);
    expect(Http::recorded(fn ($r) => str_ends_with($r->url(), '/message-matchers')))->toHaveCount(1);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
});

test('a template pending approval cannot send even when an operator requests it', function () {
    $record = formLinkRecord();
    $send = formLinkReady($record);
    formLinkHttp($record, templateStatus: 'PENDING');
    expect(fn () => (new SendEdnaFormLink($send->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_form_link_sends')->first()->state)->toBe('pending');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
});

test('a generic conversation sends an untagged home and never resurrects historic CRM attribution', function () {
    $record = formLinkRecord();
    $context = formLinkCapture('Hola', 'ignored');
    formLinkHttp($record);
    (new SyncEdnaFormLink($context->scope, $context->entry_event_id))->handle();
    $record[EdnaFormLink::SEND_FIELD] = 1;
    (new EdnaFormRequest)->poll();
    (new SendEdnaFormLink(DB::table('edna_form_link_sends')->first()->id))->handle();
    Http::assertSent(fn ($r) => str_contains($r->url(), 'cascade/schedule')
        && $r['content']['whatsappContent']['keyboard']['rows'][0]['buttons'][0]['urlPostfix'] === '?');
    expect(DB::table('edna_form_link_sends')->first()->journey_id)->toBeNull();
});

test('recovering the CRM result after confirmation never repeats the Edna send', function () {
    $record = formLinkRecord();
    $send = formLinkReady($record);
    (new SendEdnaFormLink($send->id))->handle();
    (new ReconcileEdnaFormLink($send->id))->handle();
    $record[EdnaFormLink::STATUS_FIELD] = 'Aceptado por Edna. Pendiente de confirmar entrega.';
    (new ReconcileEdnaFormLink($send->id))->handle();
    expect($record[EdnaFormLink::STATUS_FIELD])->toBe('Enviado por WhatsApp.');
    expect(Http::recorded(fn ($r) => str_contains($r->url(), 'cascade/schedule')))->toHaveCount(1);
});

test('shared layout provisioning keeps existing sections and is idempotent', function () {
    $sections = [['name' => 'main', 'title' => 'Contacto', 'type' => 'section',
        'elements' => [['name' => 'NAME', 'optionFlags' => '1']]]];
    $original = $sections;
    $writes = 0;
    Http::fake(['redunisol.bitrix24.es/*' => function ($r) use (&$sections, &$writes) {
        if (str_contains($r->url(), 'configuration.set')) {
            expect($r['scope'])->toBe('C');
            $sections = $r['data'];
            $writes++;

            return Http::response(['result' => true]);
        }
        $result = str_contains($r->url(), 'configuration.get') ? $sections : [
            EdnaFormLink::CRM_FIELD => ['type' => 'string'], EdnaFormLink::SEND_FIELD => ['type' => 'boolean'],
            EdnaFormLink::STATUS_FIELD => ['type' => 'string'],
        ];

        return Http::response(['result' => $result]);
    }]);
    expect((new EdnaFormLink)->layout('contact', true))->toBe([]);
    expect((new EdnaFormLink)->layout('contact', true))->toBe([]);
    expect($sections[0])->toBe($original[0])->and($writes)->toBe(1);
});

test('retention removes old closed recipients but keeps deduplication and uncertain sends', function () {
    $record = formLinkRecord();
    $send = formLinkReady($record);
    DB::table('edna_form_link_sends')->where('id', $send->id)->update(['state' => 'unknown']);
    $this->travel(31)->days();
    $this->artisan('edna:form-links prune --apply')->assertSuccessful();
    expect(DB::table('edna_form_links')->count())->toBe(1)
        ->and(DB::table('edna_form_link_sends')->first()->recipient)->not->toBeNull();
    DB::table('edna_form_link_sends')->where('id', $send->id)->update(['state' => 'confirmed']);
    $this->artisan('edna:form-links prune')->assertSuccessful();
    expect(DB::table('edna_form_links')->count())->toBe(1);
    $this->artisan('edna:form-links prune --apply')->assertSuccessful();
    expect(DB::table('edna_form_links')->count())->toBe(0)
        ->and(DB::table('edna_form_link_sends')->first()->recipient)->toBeNull()
        ->and(DB::table('edna_form_link_sends')->first()->entry_event_id)->toBe($send->entry_event_id);
});

test('links can be enabled while sending remains disabled with clear CRM feedback', function () {
    config()->set('edna.form_link_send_enabled', false);
    $context = formLinkCapture('(ref: '.formLinkJourney()->id.')');
    $record = formLinkRecord();
    formLinkHttp($record);
    (new SyncEdnaFormLink($context->scope, $context->entry_event_id))->handle();
    expect($record[EdnaFormLink::STATUS_FIELD])->toBe('Envío no habilitado; podés copiar el enlace.');
    $record[EdnaFormLink::SEND_FIELD] = 1;
    expect((new EdnaFormRequest)->poll())->toBe(0);
    expect(DB::table('edna_form_link_sends')->count())->toBe(0);
});

test('authenticated intake captures a reference independently of the Router send flag', function () {
    config()->set('edna.webhook_key', 'incoming-key');
    config()->set('edna.auth_header', 'Authorization');
    config()->set('edna.kestra_url', 'https://kestra.example.test/edna');
    config()->set('edna.router_enabled', false);
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true, 'event_key' => '2423:9999', 'kind' => 'router_entry'])]);
    $journey = formLinkJourney();
    $this->postJson('/api/webhooks/edna/incoming', ['id' => '9999', 'subjectId' => '2423',
        'subscriber' => ['identifier' => '5493511234567'], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola (ref: '.$journey->id.')']],
        ['Authorization' => 'Token incoming-key'])->assertOk();
    $id = DB::table('edna_incoming_events')->first()->id;
    (new ReceiveEdnaInKestra($id))->handle();
    (new ReceiveEdnaInKestra($id))->handle();
    expect(DB::table('edna_form_links')->first()->journey_id)->toBe($journey->id)
        ->and(DB::table('edna_incoming_events')->first()->status)->toBe('delivered')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    $jobs = DB::table('jobs')->pluck('payload')->implode('');
    expect($jobs)->toContain('SyncEdnaFormLink')->not->toContain('SendEdnaFormLink', 'SendEdnaFlow');
});
