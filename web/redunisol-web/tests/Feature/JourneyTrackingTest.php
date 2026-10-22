<?php

use App\Jobs\Middleware\JourneyJobMiddleware;
use App\Jobs\SyncEdnaFormLink;
use App\Services\AttributionJourney;
use App\Services\EdnaBitrix;
use App\Services\JourneyLedger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('t', 32)));
    $this->volume = storage_path('framework/testing/journey-'.Str::uuid());
    File::makeDirectory($this->volume.'/testing', 0770, true);
    File::put($this->volume.'/.redunisol-tracking-volume', 'test');
    config()->set(['journey.enabled' => true, 'journey.root' => $this->volume,
        'journey.environment' => 'testing', 'journey.export_token' => 'test-export-token',
        'database.connections.journey.database' => $this->volume.'/testing/attribution.sqlite']);
    $this->visitor = (string) Str::uuid();
    $this->session = (string) Str::uuid();
});

afterEach(function () {
    app(JourneyLedger::class)->flush();
    DB::purge('journey');
    File::deleteDirectory($this->volume);
});

function journeyBrowserEvent(): array
{
    return ['event_id' => (string) Str::uuid(), 'type' => 'page.view', 'page_id' => (string) Str::uuid(),
        'occurred_at' => now()->toIso8601String(), 'url' => 'https://localhost/jubilados?utm_source=meta&email=private#secret'];
}

test('browser batches preserve IDs and origin without accepting identity or arbitrary data', function () {
    $event = journeyBrowserEvent() + ['source' => 'bitrix', 'lead_id' => '999', 'email' => 'private'];
    $this->withCredentials()->withCookies(['ru_visitor' => $this->visitor, 'ru_session' => $this->session])
        ->withHeader('Origin', 'http://localhost')->postJson('/api/journey/events', ['events' => [$event, journeyBrowserEvent()]])
        ->assertAccepted()->assertJson(['accepted' => 2]);
    $file = glob($this->volume.'/testing/events-*.jsonl')[0];
    $events = array_map(fn ($line) => json_decode($line, true), file($file, FILE_IGNORE_NEW_LINES));
    expect($events)->toHaveCount(2)
        ->and($events[0]['event_id'])->toBe($event['event_id'])
        ->and($events[0]['source'])->toBe('web.browser')
        ->and($events[0]['links']['visitor_id'])->toBe($this->visitor)
        ->and($events[0]['data']['url'])->toBe('https://localhost/jubilados?utm_source=meta')
        ->and($events[0]['links'])->not->toHaveKey('lead_id');
});

test('capture rejects cross-origin batches and reports a missing volume without fallback', function () {
    $this->withCredentials()->withCookies(['ru_visitor' => $this->visitor, 'ru_session' => $this->session])
        ->withHeader('Origin', 'https://elsewhere.invalid')->postJson('/api/journey/events', ['events' => [journeyBrowserEvent()]])->assertForbidden();
    unlink($this->volume.'/.redunisol-tracking-volume');
    $this->withHeader('Origin', 'http://localhost')->postJson('/api/journey/events', ['events' => [journeyBrowserEvent()]])->assertStatus(503);
    expect(glob($this->volume.'/testing/events-*.jsonl'))->toBe([]);
});

test('exports require a token and byte cursors must be record boundaries', function () {
    $ledger = app(JourneyLedger::class);
    $ledger->append([$ledger->event('test.first'), $ledger->event('test.second')]);
    $this->getJson('/api/journey/export')->assertForbidden();
    $manifest = $this->withToken('test-export-token')->getJson('/api/journey/export')->assertOk()->json();
    $this->getJson('/api/journey/export?schema=1')->assertOk()->assertJsonPath('title', 'Red Unisol journey event v1');
    $date = $manifest['files'][0]['date'];
    $response = $this->get('/api/journey/export?date='.$date)->assertOk();
    expect(substr_count($response->getContent(), "\n"))->toBe(2);
    $next = $response->headers->get('X-Next-Offset');
    $this->get('/api/journey/export?date='.$date.'&offset='.$next)->assertOk()->assertContent('');
    $this->get('/api/journey/export?date='.$date.'&offset=1')->assertStatus(416);
    $this->getJson('/api/journey/export?date=../../credentials.txt')->assertUnprocessable();
});

test('attribution moves to the volume and old references import without overwriting a binding', function () {
    config()->set('attribution.enabled', true);
    $service = new AttributionJourney;
    $legacy = $service->create(['version' => 1, 'first' => [], 'last' => []]);
    $this->artisan('journey:storage initialize')->assertSuccessful();
    config()->set('attribution.connection', 'journey');
    expect($service->find($legacy->id)->id)->toBe($legacy->id);
    $service->bind('(ref: '.$legacy->id.')', '5493511234567', '77');
    $fresh = $service->create(['version' => 1, 'first' => [], 'last' => []]);
    expect(DB::table('attribution_journeys')->where('id', $fresh->id)->exists())->toBeFalse()
        ->and($service->find($legacy->id)->subject_id)->toBe('77');
    $this->artisan('journey:storage import-attribution')->assertSuccessful();
    expect($service->find($legacy->id)->subject_id)->toBe('77');
});

test('CRM exports stage transitions with replay-safe IDs and advances durable cursors', function () {
    config()->set('journey.crm_enabled', true);
    $api = Mockery::mock(EdnaBitrix::class);
    $api->shouldReceive('call')->with('crm.lead.list', Mockery::type('array'))->once()->andReturn([
        ['ID' => '10', 'DATE_MODIFY' => now()->toIso8601String(), 'UF_CRM_JOURNEY_ID' => 'Abcd123456'],
    ]);
    $api->shouldReceive('call')->with('crm.contact.list', Mockery::type('array'))->once()->andReturn([]);
    $api->shouldReceive('call')->with('crm.deal.list', Mockery::type('array'))->once()->andReturn([]);
    $api->shouldReceive('call')->with('crm.stagehistory.list', Mockery::type('array'))->twice()->andReturn(
        ['items' => [['ID' => 40, 'OWNER_ID' => 10, 'STAGE_ID' => 'NEW', 'CREATED_TIME' => now()->toIso8601String()]]], ['items' => []]);
    foreach (['crm.lead.fields', 'crm.contact.fields', 'crm.deal.fields', 'crm.status.list'] as $method) {
        $api->shouldReceive('call')->with($method)->once()->andReturn([]);
    }
    app()->instance(EdnaBitrix::class, $api);
    $this->artisan('journey:crm')->assertSuccessful();
    $state = json_decode(file_get_contents($this->volume.'/testing/crm-cursors.json'), true);
    expect($state)->toHaveKeys(['lead.snapshot', 'lead.stage', 'deal.snapshot', 'deal.stage', 'catalog_date']);
    $events = array_map(fn ($line) => json_decode($line, true), file(glob($this->volume.'/testing/events-*.jsonl')[0], FILE_IGNORE_NEW_LINES));
    expect($events[1]['type'])->toBe('crm.stage')->and($events[1]['links']['lead_id'])->toBe('10');
});

test('lost volume does not block form attribution resolution or write to the business database', function () {
    config()->set(['attribution.enabled' => true, 'attribution.connection' => 'journey']);
    unlink($this->volume.'/.redunisol-tracking-volume');
    $request = Request::create('https://redunisol.com.ar/api/form-submissions', 'POST');
    $request->cookies->set(AttributionJourney::COOKIE, 'Abcd123456');
    $input = (new AttributionJourney)->resolveForm($request, ['celular' => '3511234567', 'utm_source' => 'untrusted']);
    expect($input['attribution']['status'])->toBe('storage_unavailable')
        ->and($input)->not->toHaveKey('utm_source')
        ->and(DB::table('attribution_journeys')->count())->toBe(0);
});

test('journal recovers a partial tail and keeps every complete record parseable', function () {
    $ledger = app(JourneyLedger::class);
    $first = $ledger->event('test.first');
    $ledger->append([$first]);
    $file = glob($this->volume.'/testing/events-*.jsonl')[0];
    file_put_contents($file, '{"interrupted":', FILE_APPEND);
    $ledger->append([$ledger->event('test.second')]);
    $events = array_map(fn ($line) => json_decode($line, true, 32, JSON_THROW_ON_ERROR), file($file, FILE_IGNORE_NEW_LINES));
    expect($events)->toHaveCount(2)->and($events[0]['event_id'])->toBe($first['event_id']);
});

test('WhatsApp middleware captures CRM linkage and preserves the job outcome', function () {
    DB::table('edna_form_links')->insert([
        'scope' => str_repeat('a', 64), 'subject_id' => '77',
        'recipient' => Crypt::encryptString('5493511234567'),
        'entry_event_id' => 1, 'last_event_id' => 1, 'entry_received_at' => now(), 'last_received_at' => now(),
        'crm_entity' => 'contact', 'crm_id' => '10', 'crm_state' => 'synced', 'created_at' => now(), 'updated_at' => now(),
    ]);
    $job = new SyncEdnaFormLink(str_repeat('a', 64), 1);
    $result = (new JourneyJobMiddleware)->handle($job, fn () => 'business_result');
    $events = array_map(fn ($line) => json_decode($line, true), file(glob($this->volume.'/testing/events-*.jsonl')[0], FILE_IGNORE_NEW_LINES));
    expect($result)->toBe('business_result')->and($events[0]['links']['contact_id'])->toBe('10')
        ->and($events[0]['links']['phone_hash'])->toBe((new AttributionJourney)->phoneHash('3511234567'))
        ->and($events[0]['data']['record'])->not->toHaveKey('recipient');
});
