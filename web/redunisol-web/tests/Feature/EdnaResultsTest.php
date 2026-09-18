<?php

use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaLanding;
use App\Jobs\SendEdnaLanding;
use App\Jobs\SyncEdnaRouterCrm;
use App\Services\EdnaBitrix;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaLandingRoute;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 9, 18)->setTime(18, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('x', 32)));
    config()->set('edna', ['enabled' => true, 'router_enabled' => true, 'results_enabled' => true,
        'subject_id' => '2423', 'router_recipients' => ['5493510000000'],
        'api_key' => 'outbound-secret', 'kestra_url' => 'https://kestra.example.test/edna',
        'bitrix_url' => 'https://redunisol.bitrix24.es/rest/1/testsecret/']);
    $this->crmRecord = ['ID' => '42', 'PHONE' => [['VALUE' => '+54 9 351 0000000']],
        'SOURCE_ID' => 'GOOGLE', 'UTM_SOURCE' => 'google', 'UTM_CAMPAIGN' => 'acquisition', 'NAME' => 'Original'];
    resultHttp();
});

function resultSchema(): array
{
    $fields = [];
    foreach (EdnaBitrix::FIELDS as $name => $type) {
        $fields['UF_CRM_'.$name] = ['type' => $type, 'isMultiple' => false];
    }

    return $fields;
}

function resultHttp(array $overrides = []): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake(array_merge([
        'kestra.example.test/*' => fn ($r) => Http::response(['ok' => true, 'event_key' => $r['subjectId'].':'.$r['id'],
            'kind' => 'flow_response', 'flow_id_verified' => true]),
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
            'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/cascade/schedule' => fn ($r) => Http::response(['requestId' => $r['requestId']]),
        'app.edna.io/api/messages/history' => fn () => Http::response(['content' => [resultHistory()], 'hasNext' => false]),
        'redunisol.bitrix24.es/*/crm.duplicate.findbycomm.json' => Http::response(['result' => ['CONTACT' => [42]]]),
        'redunisol.bitrix24.es/*/crm.contact.fields.json' => Http::response(['result' => resultSchema()]),
        'redunisol.bitrix24.es/*/crm.contact.get.json' => fn () => Http::response(['result' => test()->crmRecord]),
        'redunisol.bitrix24.es/*/crm.contact.update.json' => function ($r) {
            test()->crmRecord = array_replace(test()->crmRecord, $r['fields']);

            return Http::response(['result' => true]);
        },
    ], $overrides));
}

function resultHistory(array $overrides = []): array
{
    $r = DB::table('edna_router_results')->latest('id')->first();

    return array_replace(['messageId' => 8800, 'comment' => $r->request_id, 'direction' => 'OUT', 'channelType' => 'WHATSAPP',
        'subjectId' => 2423, 'cascadeId' => 2557, 'address' => '5493510000000', 'deliveryStatus' => 'READ',
        'content' => json_encode(['type' => 'TEXT', 'text' => $r->message_text])], $overrides);
}

function resultFixture(string $province = 'caba', string $situation = 'pfa', bool $process = true): object
{
    $scope = (new EdnaFlowRouter)->scope('2423', '5493510000000');
    DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $scope, 'created_at' => now(), 'updated_at' => now()]);
    $request = (string) Str::uuid();
    $flow = DB::table('edna_flow_sends')->insertGetId(['request_id' => $request, 'entry_event_id' => 987,
        'scope' => $scope, 'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => EdnaFlowRouter::FLOW_ID,
        'recipient' => Crypt::encryptString('5493510000000'), 'state' => 'confirmed', 'outgoing_message_id' => '765',
        'entry_received_at' => now()->subMinute(), 'send_started_at' => now()->subMinute(), 'created_at' => now()->subMinute(), 'updated_at' => now()]);
    $payload = ['id' => '888', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(), 'replyOutMessageId' => '765', 'replyOutMessageExternalRequestId' => $request,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => $province, 'situacion_'.$province => $situation])]];
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => '888',
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
    if ($process) {
        (new ReceiveEdnaInKestra($id))->handle();
    }

    return (object) ['event' => $id, 'flow' => $flow, 'payload' => $payload, 'result' => DB::table('edna_router_results')->first()?->id];
}

// Expected destinations are independent business examples, not generated from the implementation map.
test('routes all supported business answers with separate WhatsApp attribution', function ($province, $situation, $segment, $path) {
    $route = (new EdnaLandingRoute)->resolve(['messageContent' => ['text' => json_encode(['provincia' => $province, 'situacion_'.$province => $situation])]]);
    expect(parse_url($route['landing_url'], PHP_URL_PATH))->toBe($path)->and($route['segment'])->toBe($segment);
    parse_str(parse_url($route['landing_url'], PHP_URL_QUERY), $query);
    expect($query)->toBe(['utm_source' => 'whatsapp', 'utm_medium' => 'messaging', 'utm_campaign' => 'web_whatsapp_router', 'utm_content' => $segment]);
})->with([
    ['cordoba', 'jubilado_pensionado', 'cordoba_jubilado', '/prestamos-para-jubilados/jubilados-cordoba'],
    ['cordoba', 'empleado_publico', 'cordoba_empleado_publico', '/prestamos-para-empleados-publicos/empleados-publicos-cordoba'],
    ['cordoba', 'policia_cordoba', 'cordoba_policia', '/prestamos-para-policias/policias-cordoba'],
    ['cordoba', 'docente', 'cordoba_docente', '/prestamos-para-docentes/docentes-cordoba'],
    ['cordoba', 'salud', 'cordoba_salud', '/prestamos-para-personal-de-salud/salud-cordoba'],
    ['cordoba', 'unc', 'cordoba_unc', '/prestamos-para-empleados-universidad-nacional-de-cordoba'],
    ['cordoba', 'otra', 'cordoba_otra', '/'],
    ['catamarca', 'empleado_publico', 'catamarca_empleado_publico', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
    ['catamarca', 'policia', 'catamarca_policia', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
    ['catamarca', 'docente', 'catamarca_docente', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
    ['catamarca', 'salud', 'catamarca_salud', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
    ['catamarca', 'otra', 'catamarca_otra', '/'], ['caba', 'pfa', 'caba_pfa', '/prestamos-para-policias/policia-federal'],
    ['caba', 'otra', 'caba_otra', '/'], ['otra', 'otra', 'otra_provincia', '/'],
]);

test('verified answer atomically reserves both jobs exactly once', function () {
    $f = resultFixture();
    (new ReceiveEdnaInKestra($f->event))->handle();
    expect(DB::table('edna_router_results')->count())->toBe(1)
        ->and(DB::table('edna_flow_sends')->find($f->flow)->state)->toBe('completed');
    $jobs = DB::table('jobs')->pluck('payload')->implode('');
    expect($jobs)->toContain('SendEdnaLanding', 'SyncEdnaRouterCrm')->not->toContain('5493510000000', 'testsecret');
});

test('unverified mismatched disabled and invalid answers have no side effects', function ($mode) {
    $f = resultFixture(process: false);
    if ($mode === 'disabled') {
        config(['edna.results_enabled' => false]);
    }
    if ($mode === 'pilot') {
        config(['edna.router_recipients' => ['5493511111111']]);
    }
    if ($mode === 'mismatched') {
        DB::table('edna_flow_sends')->update(['outgoing_message_id' => '999']);
    }
    if ($mode === 'invalid') {
        resultHttp(['kestra.example.test/*' => Http::response(['ok' => true, 'kind' => 'invalid', 'event_key' => '2423:888'])]);
    }
    if ($mode === 'unverified') {
        resultHttp(['kestra.example.test/*' => Http::response(['ok' => true, 'kind' => 'flow_response', 'event_key' => '2423:888', 'flow_id_verified' => false])]);
    }
    try {
        (new ReceiveEdnaInKestra($f->event))->handle();
    } catch (RuntimeException) {
    }
    expect(DB::table('edna_router_results')->count())->toBe(0);
    Http::assertNotSent(fn ($r) => ! str_contains($r->url(), 'kestra.example.test'));
})->with(['disabled', 'pilot', 'mismatched', 'invalid', 'unverified']);

test('landing is a single text message and history confirms its exact content', function () {
    $f = resultFixture('cordoba', 'docente');
    (new SendEdnaLanding($f->result))->handle();
    (new SendEdnaLanding($f->result))->handle();
    (new ReconcileEdnaLanding($f->result))->handle();
    (new SendEdnaLanding($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->state)->toBe('confirmed');
    $requests = Http::recorded(fn ($r) => str_ends_with($r->url(), '/cascade/schedule'));
    expect($requests)->toHaveCount(1)->and($requests->first()[0]['content']['whatsappContent']['contentType'])->toBe('TEXT')
        ->and($requests->first()[0]['content']['whatsappContent']['text'])->toContain('utm_content=cordoba_docente');
});

test('uncertain schedule is reconciled without another POST', function ($status) {
    $f = resultFixture();
    $attempts = 0;
    resultHttp(['app.edna.io/api/cascade/schedule' => function () use ($status, &$attempts) {
        $attempts++;
        if ($status === 0) {
            throw new ConnectionException('secret');
        }

        return Http::response([], $status);
    }]);
    (new SendEdnaLanding($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->state)->toBe('unknown');
    (new SendEdnaLanding($f->result))->handle();
    (new ReconcileEdnaLanding($f->result))->handle();
    expect($attempts)->toBe(1);
    expect(DB::table('edna_router_results')->first()->state)->toBe('confirmed');
})->with([0, 500, 429]);

test('landing rechecks pilot flag and response age before sending', function ($mode, $state) {
    $f = resultFixture();
    if ($mode === 'off') {
        config(['edna.results_enabled' => false]);
    }
    if ($mode === 'pilot') {
        config(['edna.router_recipients' => ['5493511111111']]);
    }
    if ($mode === 'expired') {
        $this->travel(24)->hours();
    }
    (new SendEdnaLanding($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->state)->toBe($state);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
})->with([['off', 'cancelled'], ['pilot', 'cancelled'], ['expired', 'expired']]);

test('mismatched or ambiguous landing history is not confirmed', function ($mode) {
    $f = resultFixture();
    (new SendEdnaLanding($f->result))->handle();
    $message = resultHistory($mode === 'content' ? ['content' => json_encode(['type' => 'TEXT', 'text' => 'different'])] : []);
    resultHttp(['app.edna.io/api/messages/history' => Http::response(['content' => $mode === 'duplicate' ? [$message, array_replace($message, ['messageId' => 8801])] : [$message], 'hasNext' => $mode === 'page'])]);
    expect(fn () => (new ReconcileEdnaLanding($f->result))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_router_results')->first()->state)->toBe('accepted');
})->with(['content', 'duplicate', 'page']);

test('CRM updates exactly seven fields on the existing contact and preserves attribution', function () {
    $f = resultFixture('catamarca', 'policia');
    (new SyncEdnaRouterCrm($f->result))->handle();
    (new SyncEdnaRouterCrm($f->result))->handle();
    $r = DB::table('edna_router_results')->first();
    expect($r->crm_state)->toBe('synced')->and($r->crm_entity)->toBe('contact')->and($r->crm_id)->toBe('42');
    expect($this->crmRecord)->toMatchArray(['SOURCE_ID' => 'GOOGLE', 'UTM_SOURCE' => 'google', 'UTM_CAMPAIGN' => 'acquisition',
        'NAME' => 'Original', 'UF_CRM_WA_ASSISTED' => 'SI', 'UF_CRM_WA_SEGMENT' => 'catamarca_policia']);
    $writes = Http::recorded(fn ($r) => str_ends_with($r->url(), '/crm.contact.update.json'));
    expect($writes)->toHaveCount(1)->and($writes->first()[0]['fields'])->toHaveCount(7);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.add.') || str_contains($r->url(), 'cascade/schedule'));
});

test('lost CRM update acknowledgement is recovered by read-back on the pinned record', function () {
    $f = resultFixture();
    resultHttp(['redunisol.bitrix24.es/*/crm.contact.update.json' => function ($r) {
        test()->crmRecord = array_replace(test()->crmRecord, $r['fields']);
        throw new ConnectionException('secret-webhook-url');
    }]);
    expect(fn () => (new SyncEdnaRouterCrm($f->result))->handle())->toThrow(RuntimeException::class, 'Edna CRM sync unconfirmed');
    expect(DB::table('edna_router_results')->first()->crm_id)->toBe('42');
    resultHttp(['redunisol.bitrix24.es/*/crm.duplicate.findbycomm.json' => Http::response(['result' => ['CONTACT' => [99]]])]);
    (new SyncEdnaRouterCrm($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->crm_state)->toBe('synced');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.update.') || str_contains($r->url(), 'findbycomm'));
});

test('ambiguous CRM matches are left for review without creating or updating records', function () {
    $f = resultFixture();
    resultHttp(['redunisol.bitrix24.es/*/crm.duplicate.findbycomm.json' => Http::response(['result' => ['CONTACT' => [42, 43]]])]);
    (new SyncEdnaRouterCrm($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->crm_state)->toBe('review');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.update.') || str_contains($r->url(), '.add.'));
});

test('missing CRM records retry and never create duplicates', function () {
    $f = resultFixture();
    resultHttp(['redunisol.bitrix24.es/*/crm.duplicate.findbycomm.json' => Http::response(['result' => []])]);
    expect(fn () => (new SyncEdnaRouterCrm($f->result))->handle())->toThrow(RuntimeException::class);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.update.') || str_contains($r->url(), '.add.'));
});

test('CRM rejects a changed phone and never overwrites a newer classification', function ($mode, $state) {
    $f = resultFixture();
    if ($mode === 'phone') {
        $this->crmRecord['PHONE'] = [['VALUE' => '5493511111111']];
    }
    if ($mode === 'newer') {
        $this->crmRecord['UF_CRM_WA_TIMESTAMP'] = now()->addDay()->toIso8601String();
    }
    (new SyncEdnaRouterCrm($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->crm_state)->toBe($state);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.update.'));
})->with([['phone', 'review'], ['newer', 'superseded']]);

test('schema provisioning is explicit and refuses incompatible existing fields', function () {
    resultHttp(['redunisol.bitrix24.es/*/crm.contact.fields.json' => Http::response(['result' => []]),
        'redunisol.bitrix24.es/*/crm.lead.fields.json' => Http::response(['result' => []])]);
    $this->artisan('edna:crm-fields')->assertFailed();
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.add.'));
    resultHttp(['redunisol.bitrix24.es/*/crm.contact.fields.json' => Http::response(['result' => ['UF_CRM_WA_ASSISTED' => ['type' => 'integer']]])]);
    expect(fn () => (new EdnaBitrix)->schema('contact', true))->toThrow(RuntimeException::class);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.add.'));
});

test('retention keeps recipient data while CRM or landing still needs recovery', function () {
    $f = resultFixture();
    $this->travel(40)->days();
    $this->artisan('edna:prune')->assertSuccessful();
    expect(DB::table('edna_flow_sends')->first()->recipient)->not->toBeNull();
    DB::table('edna_router_results')->update(['state' => 'confirmed', 'crm_state' => 'synced']);
    $this->artisan('edna:prune')->assertSuccessful();
    expect(DB::table('edna_flow_sends')->first()->recipient)->toBeNull();
});

test('interleaved landing workers claim a single external POST', function () {
    $f = resultFixture();
    $attempts = 0;
    resultHttp(['app.edna.io/api/cascade/schedule' => function ($r) use ($f, &$attempts) {
        $attempts++;
        (new SendEdnaLanding($f->result))->handle();

        return Http::response(['requestId' => $r['requestId']]);
    }]);
    (new SendEdnaLanding($f->result))->handle();
    expect($attempts)->toBe(1)->and(DB::table('edna_router_results')->first()->state)->toBe('accepted');
});

test('an interrupted landing worker only reconciles the committed attempt', function () {
    $f = resultFixture();
    DB::table('edna_router_results')->update(['state' => 'sending', 'send_started_at' => now()]);
    (new SendEdnaLanding($f->result))->handle();
    (new ReconcileEdnaLanding($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->state)->toBe('confirmed');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
});

test('CRM failure does not block landing and its retry does not resend it', function () {
    $f = resultFixture();
    resultHttp(['redunisol.bitrix24.es/*/crm.contact.update.json' => Http::response(['error' => 'ACCESS_DENIED'], 200)]);
    expect(fn () => (new SyncEdnaRouterCrm($f->result))->handle())->toThrow(RuntimeException::class);
    (new SendEdnaLanding($f->result))->handle();
    (new ReconcileEdnaLanding($f->result))->handle();
    resultHttp();
    (new SyncEdnaRouterCrm($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->crm_state)->toBe('synced');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
});

test('CRM can fall back to a single active lead when no contact exists', function () {
    $f = resultFixture();
    $this->crmRecord['STATUS_SEMANTIC_ID'] = 'P';
    resultHttp([
        'redunisol.bitrix24.es/*/crm.duplicate.findbycomm.json' => fn ($r) => Http::response(['result' => $r['entity_type'] === 'CONTACT' ? [] : ['LEAD' => [42]]]),
        'redunisol.bitrix24.es/*/crm.lead.fields.json' => Http::response(['result' => resultSchema()]),
        'redunisol.bitrix24.es/*/crm.lead.get.json' => fn () => Http::response(['result' => test()->crmRecord]),
        'redunisol.bitrix24.es/*/crm.lead.update.json' => function ($r) {
            test()->crmRecord = array_replace(test()->crmRecord, $r['fields']);

            return Http::response(['result' => true]);
        },
    ]);
    (new SyncEdnaRouterCrm($f->result))->handle();
    expect(DB::table('edna_router_results')->first()->crm_entity)->toBe('lead')
        ->and(DB::table('edna_router_results')->first()->crm_state)->toBe('synced');
});

test('schema apply adds only missing named fields and rechecks on the next run', function () {
    $schemas = ['contact' => [], 'lead' => []];
    resultHttp([
        'redunisol.bitrix24.es/*/crm.contact.fields.json' => fn () => Http::response(['result' => $schemas['contact']]),
        'redunisol.bitrix24.es/*/crm.lead.fields.json' => fn () => Http::response(['result' => $schemas['lead']]),
        'redunisol.bitrix24.es/*/crm.contact.userfield.add.json' => function ($r) use (&$schemas) {
            $schemas['contact']['UF_CRM_'.$r['fields']['FIELD_NAME']] = ['type' => $r['fields']['USER_TYPE_ID'], 'isMultiple' => false];

            return Http::response(['result' => 10]);
        },
        'redunisol.bitrix24.es/*/crm.lead.userfield.add.json' => function ($r) use (&$schemas) {
            $schemas['lead']['UF_CRM_'.$r['fields']['FIELD_NAME']] = ['type' => $r['fields']['USER_TYPE_ID'], 'isMultiple' => false];

            return Http::response(['result' => 20]);
        },
    ]);
    // Explicit API calls here let each new schema be returned without a stale fixture capture.
    $api = new EdnaBitrix;
    expect($api->schema('contact', true))->toHaveCount(7)->and($api->schema('lead', true))->toHaveCount(7);
    resultHttp(['redunisol.bitrix24.es/*/crm.lead.fields.json' => Http::response(['result' => resultSchema()])]);
    $this->artisan('edna:crm-fields --apply')->assertSuccessful();
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.add.'));
});

test('schema or identity failures and disabled pilot never write to CRM', function ($mode) {
    $f = resultFixture();
    if ($mode === 'off') {
        config(['edna.results_enabled' => false]);
    }
    if ($mode === 'pilot') {
        config(['edna.router_recipients' => ['5493511111111']]);
    }
    if ($mode === 'schema') {
        resultHttp(['redunisol.bitrix24.es/*/crm.contact.fields.json' => Http::response(['result' => []])]);
    }
    try {
        (new SyncEdnaRouterCrm($f->result))->handle();
    } catch (RuntimeException) {
    }
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '.update.') || str_contains($r->url(), '.add.'));
})->with(['off', 'pilot', 'schema']);

test('prepare resumes one verified pilot response without replaying Flow delivery', function () {
    config(['edna.results_enabled' => false]);
    $f = resultFixture();
    expect(DB::table('edna_router_results')->count())->toBe(0);
    config(['edna.results_enabled' => true]);
    $this->artisan('edna:results prepare '.$f->flow)->assertSuccessful();
    $this->artisan('edna:results prepare '.$f->flow)->assertSuccessful();
    expect(DB::table('edna_router_results')->count())->toBe(1)->and(DB::table('jobs')->count())->toBe(2);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io') || str_contains($r->url(), 'bitrix24.es'));
});

test('prepare cannot resume outside the explicit pilot verified state or send window', function ($mode) {
    config(['edna.results_enabled' => false]);
    $f = resultFixture();
    config(['edna.results_enabled' => true]);
    if ($mode === 'all') {
        config(['edna.router_recipients' => []]);
    }
    if ($mode === 'other') {
        config(['edna.router_recipients' => ['5493511111111']]);
    }
    if ($mode === 'expired') {
        $this->travel(24)->hours();
    }
    if ($mode === 'unverified') {
        DB::table('edna_incoming_events')->update(['router_action' => 'unmatched_response']);
    }
    $this->artisan('edna:results prepare '.$f->flow)->assertFailed();
    expect(DB::table('edna_router_results')->count())->toBe(0);
})->with(['all', 'other', 'expired', 'unverified']);

test('queue reservation failure rolls back both result and verified completion', function () {
    $f = resultFixture(process: false);
    Queue::shouldReceive('connection')->with('edna')->once()->andThrow(new RuntimeException('private'));
    expect(fn () => (new ReceiveEdnaInKestra($f->event))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_router_results')->count())->toBe(0)
        ->and(DB::table('edna_flow_sends')->first()->state)->toBe('confirmed')
        ->and(DB::table('edna_incoming_events')->first()->status)->toBe('pending');
});

test('answer timestamp offsets are stored in UTC for CRM ordering', function () {
    $f = resultFixture(process: false);
    $payload = $f->payload;
    $payload['receivedAt'] = now()->setTimezone('America/Argentina/Buenos_Aires')->toIso8601String();
    DB::table('edna_incoming_events')->where('id', $f->event)->update(['payload' => Crypt::encryptString(json_encode($payload))]);
    (new ReceiveEdnaInKestra($f->event))->handle();
    expect(DB::table('edna_router_results')->first()->response_received_at)->toBe(now()->format('Y-m-d H:i:s'));
});
