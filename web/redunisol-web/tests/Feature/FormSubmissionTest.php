<?php

use App\Actions\SubmitFormToKestra;
use App\Jobs\PersistFormSubmission;
use App\Services\MetaConversionsApiService;
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
    ]);

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => true,
        'persistence' => 'queued',
    ]);

    Queue::assertPushed(PersistFormSubmission::class, function ($job) {
        return $job->qualified
            && $job->prequalification['reason'] === 'qualified'
            && $job->input['cuil'] === '20-12345678-3'
            && $job->input['email'] === 'juan.perez@example.com'
            && $job->input['celular'] === '3511234567'
            && $job->input['provincia'] === 'Córdoba'
            && $job->input['situacion_laboral'] === 'Policia'
            && $job->input['banco'] === 'Banco de la Nacion Argentina'
            && $job->input['landing_slug'] === '/prestamos-para-policias';
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
