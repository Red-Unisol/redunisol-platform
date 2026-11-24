<?php

use App\Actions\SubmitFormToKestra;
use App\Jobs\PersistFormSubmission;
use App\Jobs\RecoverWebFormHttpAttempt;
use App\Services\MetaConversionsApiService;
use App\Services\WebFormHttpAttempt;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

it('queues form persistence after receiving commercial prequalification', function () {
    $this->freezeTime();
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');
    config()->set('services.kestra.default_lead_source', 'Google');

    Queue::fake();
    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => true,
            'route_to_whatsapp' => true,
            'reason' => 'qualified',
            'message' => 'Califica.',
            'rule_version' => '2026-07-21',
        ], 200),
    ]);

    $response = $this->postJson('/api/form-submissions', [
        'cuil' => '20-12345678-3',
        'email' => 'juan.perez@example.com',
        'celular' => '3511234567',
        'provincia' => 'Córdoba',
        'situacion_laboral' => 'Policia',
        'banco' => 'Banco de la Nacion Argentina',
        'terminos' => true,
        'landing_slug' => '/prestamos-para-policias',
        'landing_title' => 'Prestamos para Policias',
        'landing_url' => 'https://dev.redunisol.com.ar/prestamos-para-policias?utm_source=google',
        'utm_source' => 'google',
        'recibo_url' => 'https://cdn.example.test/recibos/archivo.pdf',
        'journey_page_id' => 'c7aa9165-e5c9-49aa-8db7-97e1b449f90e',
        '_form_received_at' => '2099-01-01T00:00:00Z',
    ]);

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => true,
        'persistence' => 'queued',
    ]);
    expect($response->json('web_form_reference'))->toMatch('/^[A-Za-z0-9]{32}$/D')
        ->and(DB::table('web_form_receipts')->first()->state)->toBe('pending');

    Queue::assertPushed(PersistFormSubmission::class, function ($job) {
        return $job->qualified
            && abs(now()->diffInSeconds($job->input['_form_received_at'])) < 5
            && $job->prequalification['reason'] === 'qualified'
            && $job->input['cuil'] === '20-12345678-3'
            && $job->input['email'] === 'juan.perez@example.com'
            && $job->input['celular'] === '3511234567'
            && $job->input['provincia'] === 'Córdoba'
            && $job->input['situacion_laboral'] === 'Policia'
            && $job->input['banco'] === 'Banco de la Nacion Argentina'
            && $job->input['landing_slug'] === '/prestamos-para-policias'
            && $job->input['_journey_links']['page_id'] === 'c7aa9165-e5c9-49aa-8db7-97e1b449f90e';
    });

    Http::assertSent(fn ($request) => $request->url() === 'https://kestra.example.test/prequalification'
        && $request['province'] === 'Córdoba'
        && $request['employment_status'] === 'Policia'
        && $request['payment_bank'] === 'Banco de la Nacion Argentina');
    Http::assertNotSent(fn ($request) => $request->url() === 'https://kestra.example.test/webhook');
});

it('requires the landing slug to submit the form', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Queue::fake();
    Http::fake();

    $response = $this->postJson('/api/form-submissions', [
        'email' => 'juan.perez@example.com',
        'terminos' => true,
    ]);

    $response->assertUnprocessable()->assertJsonValidationErrors(['landing_slug']);

    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

it('rejects invalid Argentine WhatsApp numbers', function (string $celular) {
    Http::fake();

    $response = $this->postJson('/api/form-submissions', [
        ...validFormPayload(),
        'celular' => $celular,
    ]);

    $response->assertUnprocessable()->assertJsonValidationErrors(['celular']);
    Http::assertNothingSent();
})->with([
    'too short' => '35112345',
    'all zeroes' => '0000000000',
    'foreign country code' => '+598 99 123 456',
]);

it('accepts an Argentine WhatsApp with international prefix', function () {
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');
    Queue::fake();
    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => true,
            'route_to_whatsapp' => true,
        ]),
    ]);

    $response = $this->postJson('/api/form-submissions', [
        ...validFormPayload(),
        'celular' => '+54 9 351 123-4567',
    ]);

    $response->assertOk();
});

it('returns not qualified while persistence continues asynchronously', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Queue::fake();
    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => false,
            'reason' => 'payment_bank_not_eligible',
            'message' => 'El banco no califica.',
        ]),
    ]);

    $response = $this->postJson('/api/form-submissions', validFormPayload());

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => false,
        'reason' => 'payment_bank_not_eligible',
        'persistence' => 'queued',
    ]);

    Queue::assertPushed(
        PersistFormSubmission::class,
        fn ($job) => $job->qualified === false
            && $job->prequalification['reason'] === 'payment_bank_not_eligible',
    );
});

it('counts the initial federal police segment without routing it to whatsapp', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Queue::fake();
    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => true,
            'route_to_whatsapp' => false,
            'reason' => 'policia_federal_caba_initial_period',
            'message' => 'Tu situación no califica para esta solicitud.',
            'rule_version' => '2026-08-31-policia-federal-caba-initial',
        ]),
    ]);

    $response = $this->postJson('/api/form-submissions', [
        ...validFormPayload(),
        'provincia' => 'Ciudad Autónoma de Buenos Aires',
        'situacion_laboral' => 'Policía Federal',
    ]);

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => true,
        'prequalified' => true,
        'route_to_whatsapp' => false,
        'action' => 'rejected',
        'reason' => 'policia_federal_caba_initial_period',
    ]);

    Queue::assertPushed(PersistFormSubmission::class, function ($job) {
        return $job->qualified
            && $job->prequalification['prequalified'] === true
            && $job->prequalification['route_to_whatsapp'] === false;
    });
});

it('shows a neutral result and still queues persistence when prequalification fails', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Queue::fake();
    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response(['ok' => false], 503),
    ]);

    $response = $this->postJson('/api/form-submissions', validFormPayload());

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => false,
        'reason' => 'prequalification_unavailable',
        'persistence' => 'queued',
    ]);

    Queue::assertPushed(
        PersistFormSubmission::class,
        fn ($job) => $job->qualified === false
            && $job->prequalification['available'] === false,
    );
});

it('persists the queued form and sends meta only after bitrix succeeds', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.default_lead_source', 'Google');
    config()->set('services.meta.pixel_id', 'pixel-123');
    config()->set('services.meta.capi_access_token', 'meta-token');
    config()->set('services.meta.capi_graph_version', 'v23.0');

    Http::fake([
        'https://kestra.example.test/webhook' => Http::response([
            'ok' => true,
            'lead_id' => '205',
            'action' => 'created',
        ]),
        'https://graph.facebook.com/*' => Http::response(['events_received' => 1]),
    ]);

    $job = new PersistFormSubmission(
        input: [
            ...validFormPayload(),
            'email' => 'juan.perez@example.com',
            'celular' => '3511234567',
        ],
        qualified: true,
        prequalification: [
            'available' => true,
            'prequalified' => true,
            'reason' => 'qualified',
            'message' => 'Califica.',
            'rule_version' => '2026-07-21',
        ],
        clientContext: [
            'ip' => '203.0.113.10',
            'user_agent' => 'Form test',
            'fbp' => 'fb.1.test',
        ],
    );

    $job->handle(
        app(SubmitFormToKestra::class),
        app(MetaConversionsApiService::class),
    );

    Http::assertSent(fn ($request) => $request->url() === 'https://kestra.example.test/webhook'
        && $request['cuil'] === '20-12345678-3'
        && $request['email'] === 'juan.perez@example.com'
        && $request['whatsapp'] === '3511234567'
        && $request['province'] === 'Córdoba'
        && $request['employment_status'] === 'Policia'
        && $request['payment_bank'] === 'Banco de la Nacion Argentina'
        && $request['landing_slug'] === '/prestamos-para-policias'
        && $request['lead_source'] === 'Google'
        && $request['prequalification_available'] === true
        && $request['prequalified'] === true
        && $request['prequalification_reason'] === 'qualified'
        && $request['prequalification_rule_version'] === '2026-07-21'
        && $request['full_name'] === 'Juan Perez');
    Http::assertSent(fn ($request) => str_starts_with(
        $request->url(),
        'https://graph.facebook.com/v23.0/pixel-123/events',
    ));
});

it('fails the queued job without sending meta when bitrix persistence fails', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.meta.pixel_id', 'pixel-123');
    config()->set('services.meta.capi_access_token', 'meta-token');

    Http::fake([
        'https://kestra.example.test/webhook' => Http::response(['ok' => false], 500),
        'https://graph.facebook.com/*' => Http::response(['events_received' => 1]),
    ]);

    $job = new PersistFormSubmission(
        input: validFormPayload(),
        qualified: true,
    );

    expect(fn () => $job->handle(
        app(SubmitFormToKestra::class),
        app(MetaConversionsApiService::class),
    ))->toThrow(RequestException::class);

    Http::assertNotSent(fn ($request) => str_starts_with(
        $request->url(),
        'https://graph.facebook.com/',
    ));
});

it('encrypts personal data in the database queue payload', function () {
    config()->set('app.key', 'base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    config()->set('queue.default', 'database');

    PersistFormSubmission::dispatch(
        input: validFormPayload(),
        qualified: true,
    );

    $payload = (string) DB::table('jobs')->value('payload');

    expect($payload)
        ->not->toContain('20-12345678-3')
        ->not->toContain('/prestamos-para-policias');
});

function validFormPayload(): array
{
    return [
        'cuil' => '20-12345678-3',
        'email' => 'juan.perez@example.com',
        'celular' => '3511234567',
        'provincia' => 'Córdoba',
        'situacion_laboral' => 'Policia',
        'banco' => 'Banco de la Nacion Argentina',
        'terminos' => true,
        'landing_slug' => '/prestamos-para-policias',
    ];
}

it('replays the exact form result and continuation after a lost HTTP response', function () {
    config(['services.kestra.prequalification_webhook_url' => 'https://kestra.test/prequalification']);
    Queue::fake();
    Http::fake(['https://kestra.test/prequalification' => Http::response(['ok' => true, 'prequalified' => true])]);
    $key = ['Idempotency-Key' => (string) Str::uuid()];
    $first = $this->postJson('/api/form-submissions', validFormPayload(), $key)->assertOk()->json();
    $originalKey = config('app.key');
    config(['app.previous_keys' => [$originalKey], 'app.key' => 'base64:'.base64_encode(str_repeat('r', 32))]);
    app()->forgetInstance('encrypter');
    Crypt::clearResolvedInstance('encrypter');
    $this->postJson('/api/form-submissions', validFormPayload() + ['utm_source' => 'reloaded'], $key)
        ->assertOk()->assertExactJson($first);
    $this->postJson('/api/form-submissions', array_replace(validFormPayload(), ['email' => 'new@example.test']), $key)
        ->assertConflict();
    $this->postJson('/api/form-submissions', validFormPayload(), ['Idempotency-Key' => (string) Str::uuid()])
        ->assertOk()->assertJsonMissing(['web_form_reference' => $first['web_form_reference']]);
    expect(DB::table('web_form_receipts')->count())->toBe(2);
    Http::assertSentCount(2);
    Queue::assertPushed(PersistFormSubmission::class, 2);
});

it('recovers from encrypted custody without a browser retry even after the public replay expires', function () {
    $this->freezeTime();
    config(['services.kestra.prequalification_webhook_url' => 'https://kestra.test/prequalification']);
    Http::fake(['https://kestra.test/prequalification' => Http::response(['ok' => true, 'prequalified' => true])]);
    $key = (string) Str::uuid();
    $input = validFormPayload() + ['_journey_links' => ['submission_id' => (string) Str::uuid()],
        '_form_received_at' => now()->toIso8601String(), 'utm_source' => 'facebook'];
    $context = ['ip' => '192.0.2.71', 'user_agent' => 'original-browser'];
    app(WebFormHttpAttempt::class)->open($key, validFormPayload(), $input, $context);
    $row = DB::table('web_form_http_attempts')->first();
    $pending = DB::table('jobs')->sole();
    expect($pending->queue)->toBe('web-forms-reconcile')->and($row->response)->toBeNull()
        ->and($row->snapshot)->not->toContain($input['email'])
        ->and(json_decode(Crypt::decryptString($row->snapshot), true))->toBe(['input' => $input, 'answers' => validFormPayload(), 'clientContext' => $context]);
    // Also recover if the original HTTP worker died just after acquiring the evaluation lease.
    DB::table('web_form_http_attempts')->where('request_key', $key)
        ->update(['evaluation_token' => (string) Str::uuid(), 'evaluation_until' => now()->addMinute()]);
    $this->travel(25)->hours();
    $this->postJson('/api/form-submissions', validFormPayload(), ['Idempotency-Key' => $key])->assertConflict();
    $recovery = Queue::connection('edna')->pop('web-forms-reconcile');
    expect($recovery->resolveName())->toBe(RecoverWebFormHttpAttempt::class);
    $recovery->fire();
    $row = DB::table('web_form_http_attempts')->first();
    $job = DB::table('jobs')->where('queue', 'web-forms')->sole();
    $command = unserialize(Crypt::decrypt(json_decode($job->payload, true)['data']['command']));
    expect($row->snapshot)->toBeNull()->and($row->response)->not->toBeNull()
        ->and($command)->toBeInstanceOf(PersistFormSubmission::class)->and($command->input)->toBe($input)
        ->and($command->clientContext)->toBe($context)->and($job->payload)->not->toContain($input['email']);
    Http::assertSentCount(1);
});

it('serializes a concurrent HTTP evaluation and recovery and enqueues only the original request', function () {
    $this->freezeTime();
    Queue::fake();
    config(['services.kestra.prequalification_webhook_url' => 'https://kestra.test/prequalification']);
    $key = (string) Str::uuid();
    $input = validFormPayload() + ['_journey_links' => ['submission_id' => (string) Str::uuid()],
        '_form_received_at' => now()->toIso8601String(), 'utm_source' => 'facebook'];
    $attempts = app(WebFormHttpAttempt::class);
    $attempts->open($key, validFormPayload(), $input, ['user_agent' => 'original']);
    $attempts->open($key, validFormPayload(), array_replace($input, ['utm_source' => 'reload']), ['user_agent' => 'changed']);
    $contended = false;
    Http::fake(['https://kestra.test/prequalification' => function () use ($attempts, $key, &$contended) {
        try {
            (new RecoverWebFormHttpAttempt($key))->handle($attempts);
        } catch (HttpException $busy) {
            $contended = $busy->getStatusCode() === 503;
        }

        return Http::response(['ok' => true, 'prequalified' => true]);
    }]);
    $result = $attempts->complete($key);
    (new RecoverWebFormHttpAttempt($key))->handle($attempts);
    expect($contended)->toBeTrue()->and($attempts->complete($key))->toBe($result);
    Queue::assertPushed(RecoverWebFormHttpAttempt::class, 1);
    Queue::assertPushed(PersistFormSubmission::class, 1);
    Queue::assertPushed(PersistFormSubmission::class, fn ($job) => $job->input === $input && $job->clientContext['user_agent'] === 'original');
    Http::assertSentCount(1);
});

it('rolls back the queued CRM job when committing the website acknowledgement fails', function () {
    config(['services.kestra.prequalification_webhook_url' => 'https://kestra.test/prequalification']);
    Http::fake(['https://kestra.test/prequalification' => Http::response(['ok' => true, 'prequalified' => true])]);
    $key = ['Idempotency-Key' => (string) Str::uuid()];
    DB::statement("CREATE TRIGGER simulate_ack_failure BEFORE UPDATE OF response ON web_form_http_attempts BEGIN SELECT RAISE(FAIL, 'simulated failure'); END");
    $this->postJson('/api/form-submissions', validFormPayload(), $key)->assertStatus(503);
    expect(DB::table('jobs')->where('queue', 'web-forms')->count())->toBe(0)
        ->and(DB::table('jobs')->where('queue', 'web-forms-reconcile')->count())->toBe(1)
        ->and(DB::table('web_form_http_attempts')->value('snapshot'))->not->toBeNull();
    DB::statement('DROP TRIGGER simulate_ack_failure');
    $this->postJson('/api/form-submissions', validFormPayload(), $key)->assertOk();
    expect(DB::table('web_form_receipts')->count())->toBe(1)
        ->and(DB::table('jobs')->where('queue', 'web-forms')->count())->toBe(1);
});
