<?php

use App\Actions\SubmitFormToKestra;
use App\Jobs\PersistFormSubmission;
use App\Models\Page;
use App\Services\AttributionJourney;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('attribution.enabled', true);
    Http::preventStrayRequests();
});

function analyticsJourney(): object
{
    return (new AttributionJourney)->touch(Request::create('https://redunisol.test/a?utm_source=google&utm_campaign=original&gclid=click'));
}

test('analytics bridge uses only the encrypted cookie and leaves acquisition intact', function () {
    $s = new AttributionJourney;
    $j = analyticsJourney();
    $other = analyticsJourney();
    $before = $s->snapshot($j);
    $this->withCredentials()->withCookie(AttributionJourney::COOKIE, $j->id)
        ->postJson('https://redunisol.test/api/attribution/analytics', [
            'ga_client_id' => '123456789.1791469720', 'ga_session_id' => '1791469719',
            'ref' => $other->id, 'first' => ['utm_source' => 'forged'],
        ], ['Origin' => 'https://redunisol.test'])->assertNoContent();
    $snapshot = $s->snapshot($s->find($j->id));
    expect($snapshot['ga_client_id'])->toBe('123456789.1791469720');
    expect($snapshot['ga_session_id'])->toBe('1791469719');
    expect($snapshot['first'])->toBe($before['first']);
    expect($snapshot['last'])->toBe($before['last']);
    expect($s->snapshot($s->find($other->id)))->not->toHaveKey('ga_client_id');
});

test('first observed analytics identity is immutable and never mixes browsers', function () {
    $s = new AttributionJourney;
    $j = analyticsJourney();
    $s->recordAnalytics($j->id, ['ga_client_id' => '123.456']);
    $s->recordAnalytics($j->id, ['ga_client_id' => '999.888', 'ga_session_id' => '111']);
    expect($s->snapshot($s->find($j->id)))->not->toHaveKey('ga_session_id');
    $s->recordAnalytics($j->id, ['ga_client_id' => '123.456', 'ga_session_id' => '222']);
    $s->recordAnalytics($j->id, ['ga_client_id' => '123.456', 'ga_session_id' => '333']);
    expect($s->snapshot($s->find($j->id))['ga_client_id'])->toBe('123.456');
    expect($s->snapshot($s->find($j->id))['ga_session_id'])->toBe('222');
});

test('later campaigns and independent WhatsApp handoffs preserve analytics identifiers', function () {
    $s = new AttributionJourney;
    $j = analyticsJourney();
    $s->recordAnalytics($j->id, ['ga_client_id' => '123.456', 'ga_session_id' => '222']);
    $request = Request::create('https://redunisol.test/b?utm_source=meta&fbclid=second');
    $request->cookies->set(AttributionJourney::COOKIE, $j->id);
    $second = $s->touch($request);
    $response = $this->withCookie(AttributionJourney::COOKIE, $second->id)->get('/whatsapp/start?'.http_build_query([
        'phone' => '5493511234567', 'text' => 'Hola, vengo del sitio web de Red Unisol. Acepto los terminos.',
    ]))->assertRedirect()->assertHeader('Referrer-Policy', 'no-referrer');
    parse_str(parse_url($response->headers->get('Location'), PHP_URL_QUERY), $query);
    expect($query['text'])->toContain('vengo del sitio web de Red Unisol. Acepto los terminos.');
    expect($query['text'])->not->toContain('123.456');
    preg_match('/ref: ([A-Za-z0-9]{10})/', $query['text'], $match);
    $handoff = $s->find($match[1]);
    expect($handoff->id)->not->toBe($second->id);
    foreach ([$s->snapshot($second), $s->snapshot($handoff)] as $snapshot) {
        expect($snapshot['ga_client_id'])->toBe('123.456');
        expect($snapshot['ga_session_id'])->toBe('222');
        expect($snapshot['first']['utm_source'])->toBe('google');
        expect($snapshot['last']['utm_source'])->toBe('meta');
    }
    $crm = json_decode($s->crmFields($handoff)['UF_CRM_ATTR_JSON'], true);
    expect($crm['ga_client_id'])->toBe('123.456');
});

test('missing invalid or expired cookies do not create or enrich a journey', function (string $cookie) {
    $j = analyticsJourney();
    if ($cookie === 'expired') {
        DB::table('attribution_journeys')->where('id', $j->id)->update(['expires_at' => now()->subMinute()]);
        $cookie = $j->id;
    }
    $this->withCredentials()->withCookie(AttributionJourney::COOKIE, $cookie)
        ->postJson('/api/attribution/analytics', ['ga_client_id' => '123.456'])->assertNoContent();
    expect(DB::table('attribution_journeys')->count())->toBe(1);
    $snapshot = (new AttributionJourney)->snapshot(DB::table('attribution_journeys')->first());
    expect($snapshot)->not->toHaveKey('ga_client_id');
})->with(['', 'invalid', 'expired']);

test('analytics flag off and cross origin requests cannot change snapshots', function () {
    $j = analyticsJourney();
    $this->withCredentials()->withCookie(AttributionJourney::COOKIE, $j->id)
        ->postJson('/api/attribution/analytics', ['ga_client_id' => '123.456'], ['Origin' => 'https://other.test'])
        ->assertForbidden();
    config()->set('attribution.enabled', false);
    $this->postJson('/api/attribution/analytics', ['ga_client_id' => '123.456'])->assertNoContent();
    expect((new AttributionJourney)->snapshot((new AttributionJourney)->find($j->id)))->not->toHaveKey('ga_client_id');
});

test('malformed analytics identifiers are rejected before persistence', function (array $payload) {
    $j = analyticsJourney();
    $this->withCredentials()->withCookie(AttributionJourney::COOKIE, $j->id)
        ->postJson('/api/attribution/analytics', $payload)->assertUnprocessable();
    expect((new AttributionJourney)->snapshot((new AttributionJourney)->find($j->id)))->not->toHaveKey('ga_client_id');
})->with([
    [['ga_client_id' => 'invalid']],
    [['ga_client_id' => str_repeat('1', 21).'.123']],
    [['ga_client_id' => '123.456', 'ga_session_id' => 'ASV1.G-RENEBND2BG:123']],
    [['ga_client_id' => '123.456', 'ga_session_id' => ['123']]],
]);

test('analytics persistence failure is optional and never blocks a visitor', function () {
    DB::shouldReceive('transaction')->andThrow(new RuntimeException('unavailable'));
    $this->withCredentials()->withCookie(AttributionJourney::COOKIE, 'a7Kp3mR9xB')
        ->postJson('/api/attribution/analytics', ['ga_client_id' => '123.456'])->assertNoContent();
});

test('UAT landing A with UTM then B without UTM queues original origin and GA IDs', function () {
    foreach (['/uat-a', '/uat-b'] as $slug) {
        Page::create(['slug' => $slug, 'title' => 'UAT', 'sections' => []]);
    }
    $this->withoutVite();
    Queue::fake();
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/intake');
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true, 'prequalified' => true])]);

    // Transfer the actual response cookie, including Laravel encryption, as a browser does.
    $a = $this->get('/uat-a?utm_source=google&utm_medium=cpc&utm_campaign=uat22321&gclid=clickA')->assertOk();
    $id = $a->getCookie(AttributionJourney::COOKIE)->getValue();
    $this->withCredentials()->withUnencryptedCookie(AttributionJourney::COOKIE, $a->getCookie(AttributionJourney::COOKIE, false)->getValue())
        ->postJson('/api/attribution/analytics', ['ga_client_id' => '123.456', 'ga_session_id' => '222'])->assertNoContent();
    $b = $this->get('/uat-b')->assertOk();
    expect($b->getCookie(AttributionJourney::COOKIE)->getValue())->toBe($id);
    $this->withUnencryptedCookie(AttributionJourney::COOKIE, $b->getCookie(AttributionJourney::COOKIE, false)->getValue())
        ->postJson('/api/form-submissions', [
            'landing_slug' => '/uat-b', 'landing_url' => 'http://localhost/uat-b',
            'celular' => '3511234567', 'terminos' => true,
        ])->assertOk()->assertJsonPath('tracking.utm_campaign', 'uat22321');

    $job = Queue::pushed(PersistFormSubmission::class)->sole();
    $snapshot = $job->input['attribution'];
    expect($snapshot['journey_id'])->toBe($id);
    expect($snapshot['first']['landing'])->toBe('http://localhost/uat-a');
    expect($snapshot['last']['landing'])->toBe('http://localhost/uat-a');
    expect($snapshot['first']['utm_campaign'])->toBe('uat22321');
    expect($snapshot['first']['gclid'])->toBe('clickA');
    expect($snapshot['ga_client_id'])->toBe('123.456');
    expect($snapshot['ga_session_id'])->toBe('222');
    expect($job->input['landing_url'])->toBe('http://localhost/uat-b');
    expect($job->input['utm_source'])->toBe('google');

    (new SubmitFormToKestra)->execute($job->input);
    Http::assertSent(fn ($request) => $request->url() === 'https://kestra.example.test/intake'
        && $request['attribution'] === $snapshot && $request['landing_slug'] === '/uat-b'
        && $request['utm_campaign'] === 'uat22321');
});
