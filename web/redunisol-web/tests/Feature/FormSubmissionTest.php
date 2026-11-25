<?php

use App\Actions\SubmitFormToKestra;
use App\Exceptions\RetryableFormPersistenceFailure;
use App\Jobs\PersistFormSubmission;
use App\Services\MetaConversionsApiService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

it('queues form persistence after receiving commercial prequalification', function () {
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

    $job = (new PersistFormSubmission(
        input: validFormPayload(),
        qualified: true,
    ))->withFakeQueueInteractions();

    $job->handle(
        app(SubmitFormToKestra::class),
        app(MetaConversionsApiService::class),
    );

    // HTTP 500: Kestra pudo haber creado el lead, asi que no se reintenta.
    $job->assertFailedWith(RequestException::class);

    Http::assertNotSent(fn ($request) => str_starts_with(
        $request->url(),
        'https://graph.facebook.com/',
    ));
});

it('retries only with waits of several minutes', function () {
    $job = new PersistFormSubmission(input: validFormPayload(), qualified: false);

    expect($job->tries)->toBe(4)
        ->and($job->backoff)->toBe([300, 900, 1800]);
});

it('retries when bitrix rejects the lead before creating it', function (string $message) {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    Http::fake([
        'https://kestra.example.test/webhook' => Http::response([
            'ok' => false, 'lead_id' => '', 'contact_id' => '77', 'action' => 'error', 'message' => $message,
        ]),
    ]);

    $job = (new PersistFormSubmission(input: validFormPayload(), qualified: false))->withFakeQueueInteractions();

    expect(fn () => $job->handle(app(SubmitFormToKestra::class), app(MetaConversionsApiService::class)))
        ->toThrow(RetryableFormPersistenceFailure::class);
    $job->assertNotFailed();
})->with([
    'limite de pedidos' => ['Bitrix24 devolvio HTTP 503: {"error":"QUERY_LIMIT_EXCEEDED","error_description":"Too many requests"}'],
    'limite sin http' => ['Too many requests'],
    'bitrix 502' => ['Bitrix24 devolvio HTTP 502: <html>Bad Gateway</html>'],
    'red' => ['Error de red contra Bitrix24: [Errno 111] Connection refused'],
]);

it('does not retry a bitrix rejection that cannot succeed or already created the lead', function (array $body) {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    Http::fake(['https://kestra.example.test/webhook' => Http::response($body)]);

    $job = (new PersistFormSubmission(input: validFormPayload(), qualified: false))->withFakeQueueInteractions();
    $job->handle(app(SubmitFormToKestra::class), app(MetaConversionsApiService::class));

    $job->assertFailed();
})->with([
    'email invalido' => [['ok' => false, 'lead_id' => '', 'message' => 'Bitrix24 devolvio HTTP 400: {"error":"","error_description":"Email invalido"}']],
    'lead ya creado' => [['ok' => false, 'lead_id' => '205', 'message' => 'Bitrix24 devolvio HTTP 503: QUERY_LIMIT_EXCEEDED']],
    'sin mensaje' => [['ok' => false]],
]);

it('retries only the http errors where kestra never got the form', function (int $status, bool $retried) {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    Http::fake(['https://kestra.example.test/webhook' => Http::response('', $status)]);

    $job = (new PersistFormSubmission(input: validFormPayload(), qualified: false))->withFakeQueueInteractions();
    $run = fn () => $job->handle(app(SubmitFormToKestra::class), app(MetaConversionsApiService::class));

    if ($retried) {
        expect($run)->toThrow(RetryableFormPersistenceFailure::class);
        $job->assertNotFailed();
    } else {
        $run();
        $job->assertFailed();
    }
})->with([
    'proxy 502' => [502, true],
    'proxy 503' => [503, true],
    'cloudflare origen caido 521' => [521, true],
    'cloudflare tls 525' => [525, true],
    'error interno 500' => [500, false],
    'gateway timeout 504' => [504, false],
    'cloudflare desconocido 520' => [520, false],
    'cloudflare timeout 524' => [524, false],
]);

it('retries a connection failure but not a timeout', function (string $message, bool $retried) {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    Http::fake(fn () => throw new ConnectionException($message));

    $job = (new PersistFormSubmission(input: validFormPayload(), qualified: false))->withFakeQueueInteractions();
    $run = fn () => $job->handle(app(SubmitFormToKestra::class), app(MetaConversionsApiService::class));

    if ($retried) {
        expect($run)->toThrow(RetryableFormPersistenceFailure::class);
        $job->assertNotFailed();
    } else {
        $run();
        $job->assertFailedWith(ConnectionException::class);
    }
})->with([
    'conexion rechazada' => ['cURL error 7: Failed to connect to kestra.example.test port 443', true],
    'dns' => ['cURL error 6: Could not resolve host: kestra.example.test', true],
    'tiempo agotado' => ['cURL error 28: Operation timed out after 60001 milliseconds', false],
]);

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
