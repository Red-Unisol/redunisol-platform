<?php

use App\Actions\SubmitFormToKestra;
use App\Jobs\PersistFormSubmission;
use App\Models\Page;
use App\Services\AttributionJourney;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('attribution.enabled', true);
    Http::preventStrayRequests();
});

function attributionVisit(string $query = '', ?string $previous = null): object
{
    $request = Request::create('https://redunisol.com.ar/jubilados'.$query);
    if ($previous) {
        $request->cookies->set(AttributionJourney::COOKIE, $previous);
    }

    return (new AttributionJourney)->touch($request);
}

test('first acquisition survives navigation and a later campaign updates only last', function () {
    $s = new AttributionJourney;
    $meta = attributionVisit('?utm_source=meta&utm_campaign=cordoba&fbclid=click1');
    $direct = attributionVisit('', $meta->id);
    expect($direct->id)->toBe($meta->id);
    $google = attributionVisit('?utm_source=google&utm_campaign=segunda&gclid=click2', $direct->id);
    expect($google->id)->not->toBe($meta->id);
    expect($s->snapshot($google)['first']['utm_source'])->toBe('meta');
    expect($s->snapshot($google)['last']['utm_source'])->toBe('google');
    expect($s->snapshot($meta)['last']['utm_source'])->toBe('meta');
    expect($s->snapshot($meta)['first']['landing'])->not->toContain('fbclid');
    expect($meta->snapshot)->not->toContain('cordoba');
});

test('return reference wins over internal WhatsApp UTMs and another browser campaign', function () {
    $meta = attributionVisit('?utm_source=meta');
    $google = attributionVisit('?utm_source=google');
    $returned = attributionVisit('?ref='.$meta->id.'&utm_source=whatsapp&utm_campaign=web_whatsapp_router', $google->id);
    expect($returned->id)->toBe($meta->id);
    expect((new AttributionJourney)->snapshot($returned)['last']['utm_source'])->toBe('meta');
});

test('reference binds once to a verified incoming identity and tolerates Argentine formats', function () {
    $s = new AttributionJourney;
    $j = attributionVisit('?utm_source=meta');
    $text = 'Hola, vengo del sitio web de Red Unisol. (ref: '.$j->id.')';
    expect($s->bind($text, '5493511234567', '2423'))->toBe($j->id);
    expect($s->bind($text, '+54 3511234567', '2423'))->toBe($j->id);
    expect($s->bind($text, '5493517654321', '2423'))->toBeNull();
    expect($s->bind($text, '5493511234567', '9999'))->toBeNull();
    expect($s->bind('mensaje sin codigo', '5493511234567', '2423'))->toBeNull();
});

test('form uses server snapshot and does not trust supplied attribution', function () {
    $s = new AttributionJourney;
    $j = attributionVisit('?utm_source=meta&utm_campaign=original&fbclid=123');
    $s->bind('(ref: '.$j->id.')', '5493511234567', '2423');
    $input = $s->resolveForm(Request::create('/'), ['ref' => $j->id, 'celular' => '3511234567',
        'utm_source' => 'whatsapp', 'attribution' => ['version' => 99]]);
    expect($input['utm_source'])->toBe('meta');
    expect($input['utm_campaign'])->toBe('original');
    expect($input['attribution']['wa_assisted'])->toBeTrue();
    expect($input['attribution']['version'])->toBe(1);
});

test('a shared or invalid reference does not inherit the other persons origin', function () {
    $s = new AttributionJourney;
    $j = attributionVisit('?utm_source=meta');
    $s->bind('(ref: '.$j->id.')', '5493511234567', '2423');
    $r = Request::create('/');
    $r->cookies->set(AttributionJourney::COOKIE, $j->id);
    foreach ([$j->id, str_repeat('0', 24), 'invalid'] as $ref) {
        $input = $s->resolveForm($r, ['ref' => $ref, 'celular' => '3517654321', 'utm_source' => 'whatsapp']);
        expect($input['attribution']['status'])->toBe('unresolved_ref');
        expect($input['attribution']['wa_assisted'])->toBeFalse();
        expect($input)->not->toHaveKey('utm_source');
    }
});

test('references expire without blocking a submission or inventing Google', function () {
    $s = new AttributionJourney;
    $j = attributionVisit('?utm_source=meta');
    $this->travel(31)->days();
    expect($s->find($j->id))->toBeNull();
    $input = $s->resolveForm(Request::create('/'), ['ref' => $j->id]);
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/intake');
    config()->set('services.kestra.default_lead_source', 'Google');
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true])]);
    (new SubmitFormToKestra)->execute($input);
    Http::assertSent(fn ($r) => $r['lead_source'] === 'Sin origen'
        && $r['attribution']['status'] === 'unresolved_ref');
});

test('redirect appends an opaque reference and allows only WhatsApp destinations', function () {
    $j = attributionVisit('?utm_source=meta');
    $response = $this->withCookie(AttributionJourney::COOKIE, $j->id)
        ->get('/whatsapp/start?'.http_build_query(['phone' => '5493511234567', 'text' => 'Hola, vengo del sitio web de Red Unisol.']));
    $response->assertRedirect();
    $location = $response->headers->get('Location');
    expect(parse_url($location, PHP_URL_HOST))->toBe('wa.me');
    parse_str(parse_url($location, PHP_URL_QUERY), $query);
    expect($query['text'])->toMatch('/\\(ref: [A-Za-z0-9]{10}\\)/');
    preg_match('/ref: ([A-Za-z0-9]{10})/', $query['text'], $m);
    $handoff = (new AttributionJourney)->find($m[1]);
    expect($handoff->id)->not->toBe($j->id);
    expect((new AttributionJourney)->snapshot($handoff)['last']['utm_source'])->toBe('meta');
    $this->getJson('/whatsapp/start?phone=https://evil.test')->assertUnprocessable();
});

test('failure to persist a handoff still opens WhatsApp with the original message', function () {
    DB::shouldReceive('table')->andThrow(new RuntimeException('unavailable'));
    $response = $this->get('/whatsapp/start?phone=5493511234567&text=Hola');
    $response->assertRedirect('https://wa.me/5493511234567?text=Hola');
});

test('public page capture writes an encrypted HttpOnly cookie, no origin values', function () {
    Page::create(['slug' => '/attribution-test', 'title' => 'Test', 'sections' => []]);
    $this->withoutVite();
    $response = $this->get('/attribution-test?utm_source=meta&utm_campaign=first');
    $response->assertOk()->assertCookie(AttributionJourney::COOKIE);
    $cookie = collect($response->headers->getCookies())->first(fn ($c) => $c->getName() === AttributionJourney::COOKIE);
    expect($cookie->isHttpOnly())->toBeTrue();
    expect($cookie->getValue())->not->toContain('first');
    expect($response->headers->get('Cache-Control'))->toContain('no-store');
});

test('encrypted page cookie is read by form API and snapshot is queued for persistence', function () {
    $j = attributionVisit('?utm_source=meta&utm_campaign=original');
    Queue::fake();
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true, 'prequalified' => true])]);
    $this->withCredentials()->withUnencryptedCookie('_fbp', 'fb.1.browser')
        ->withUnencryptedCookie('_fbc', 'fb.1.click')
        ->withCookie(AttributionJourney::COOKIE, $j->id)->postJson('/api/form-submissions', [
            'landing_slug' => '/jubilados', 'celular' => '3511234567', 'terminos' => true,
            'utm_source' => 'whatsapp', 'attribution' => ['first' => ['utm_source' => 'forged']],
        ])->assertOk();
    Queue::assertPushed(PersistFormSubmission::class, fn ($job) => $job->input['utm_source'] === 'meta'
        && $job->input['attribution']['journey_id'] === $j->id
        && $job->clientContext['fbp'] === 'fb.1.browser' && $job->clientContext['fbc'] === 'fb.1.click');
});

test('flag off preserves legacy requests and never creates journeys', function () {
    config()->set('attribution.enabled', false);
    $s = new AttributionJourney;
    expect($s->resolveForm(Request::create('/'), ['utm_source' => 'google']))->toBe(['utm_source' => 'google']);
    $this->get('/whatsapp/start?phone=5493511234567&text=Hola')->assertRedirect('https://wa.me/5493511234567?text=Hola');
    expect(DB::table('attribution_journeys')->count())->toBe(0);
});

test('CRM provisioning preserves existing enum IDs and is idempotent', function () {
    config()->set('edna.bitrix_url', 'https://redunisol.bitrix24.es/rest/1/testkey/');
    $schemas = ['lead' => [], 'contact' => [], 'deal' => []];
    $options = ['lead' => [['ID' => '25', 'VALUE' => 'Google', 'SORT' => 10, 'DEF' => 'N']],
        'deal' => [['ID' => '35', 'VALUE' => 'Facebook', 'SORT' => 20, 'DEF' => 'N']]];
    $updates = 0;
    Http::fake(['redunisol.bitrix24.es/*' => function ($r) use (&$schemas, &$options, &$updates) {
        preg_match('/crm\.(contact|lead|deal)\.(.+)\.json$/', $r->url(), $m);
        [$entity, $method] = [$m[1], $m[2]];
        $result = match ($method) {
            'fields' => $schemas[$entity],
            'userfield.list' => [['ID' => '1', 'USER_TYPE_ID' => 'enumeration']],
            'userfield.get' => ['ID' => '1', 'LIST' => $options[$entity]],
            default => true,
        };
        if ($method === 'userfield.add') {
            $schemas[$entity]['UF_CRM_'.$r['fields']['FIELD_NAME']] = ['type' => $r['fields']['USER_TYPE_ID'], 'isMultiple' => false];
        }
        if ($method === 'userfield.update') {
            $updates++;
            $options[$entity] = $r['fields']['LIST'];
        }

        return Http::response(['result' => $result]);
    }]);
    $this->artisan('attribution:crm-schema')->assertFailed();
    expect($updates)->toBe(0);
    $this->artisan('attribution:crm-schema --apply')->assertSuccessful();
    expect($options['lead'][0]['ID'])->toBe('25');
    expect($options['deal'][0]['VALUE'])->toBe('Facebook');
    expect($updates)->toBe(2);
    $this->artisan('attribution:crm-schema --apply')->assertSuccessful();
    expect($updates)->toBe(2);
});

test('pruning removes expired snapshots only and is read only by default', function () {
    $old = attributionVisit('?utm_source=meta');
    $this->travel(31)->days();
    $active = attributionVisit('?utm_source=google');
    $this->artisan('attribution:prune')->assertSuccessful();
    expect(DB::table('attribution_journeys')->count())->toBe(2);
    $this->artisan('attribution:prune --apply')->assertSuccessful();
    expect(DB::table('attribution_journeys')->where('id', $old->id)->exists())->toBeFalse();
    expect(DB::table('attribution_journeys')->where('id', $active->id)->exists())->toBeTrue();
});

test('handoff rate limiting skips recording without blocking contact', function () {
    $key = 'attribution-handoff:'.hash('sha256', '127.0.0.1');
    for ($i = 0; $i < 60; $i++) {
        RateLimiter::hit($key, 60);
    }
    $this->get('/whatsapp/start?phone=5493511234567&text=Hola')->assertRedirect('https://wa.me/5493511234567?text=Hola');
    expect(DB::table('attribution_journeys')->count())->toBe(0);
});

test('short and legacy references survive binding and form submission', function (string $id) {
    $s = new AttributionJourney;
    $j = attributionVisit('?utm_source=meta&utm_campaign=original');
    DB::table('attribution_journeys')->where('id', $j->id)->update(['id' => $id]);
    expect($s->find($id)->id)->toBe($id);
    $incoming = strlen($id) === 24 ? strtoupper($id) : $id;
    expect($s->bind('(REF: '.$incoming.')', '5493511234567', '2423'))->toBe($id);
    $resolved = $s->resolveForm(Request::create('/'), ['ref' => $id, 'celular' => '3511234567']);
    expect($resolved['attribution']['journey_id'])->toBe($id);
    expect($resolved['utm_campaign'])->toBe('original');
    if (strlen($id) === 10) {
        expect($s->find(strtolower($id)))->toBeNull();
        expect($s->bind('(ref: '.strtolower($id).')', '5493511234567', '2423'))->toBeNull();
    }
})->with(['a7Kp3mR9xB', 'abcdef0123456789abcdef01']);

test('handoff replaces previous short and legacy references without changing the message', function (string $old) {
    $response = $this->get('/whatsapp/start?'.http_build_query([
        'phone' => '5493511234567', 'text' => 'Hola, acepto los terminos. (ref: '.$old.')',
    ]));
    $response->assertRedirect();
    parse_str(parse_url($response->headers->get('Location'), PHP_URL_QUERY), $query);
    expect($query['text'])->toMatch('/^Hola, acepto los terminos\. \(ref: [A-Za-z0-9]{10}\)$/D');
    expect($query['text'])->not->toContain($old);
})->with(['a7Kp3mR9xB', 'abcdef0123456789abcdef01']);

test('colliding references retry without changing the existing journey', function () {
    Str::createRandomStringsUsingSequence(['a7Kp3mR9xB', 'a7Kp3mR9xB', 'B9xR7mK3pA']);
    try {
        $old = attributionVisit('?utm_source=meta');
        $new = attributionVisit('?utm_source=google');
        expect($new->id)->toBe('B9xR7mK3pA');
        expect((new AttributionJourney)->snapshot((new AttributionJourney)->find($old->id))['last']['utm_source'])->toBe('meta');
        expect(DB::table('attribution_journeys')->count())->toBe(2);
    } finally {
        Str::createRandomStringsNormally();
    }
});

test('exhausted collisions still allow WhatsApp without reusing another journey', function () {
    Str::createRandomStringsUsing(fn () => 'a7Kp3mR9xB');
    try {
        attributionVisit('?utm_source=meta');
        $this->get('/whatsapp/start?phone=5493511234567&text=Hola')->assertRedirect('https://wa.me/5493511234567?text=Hola');
        expect(DB::table('attribution_journeys')->count())->toBe(1);
    } finally {
        Str::createRandomStringsNormally();
    }
});
