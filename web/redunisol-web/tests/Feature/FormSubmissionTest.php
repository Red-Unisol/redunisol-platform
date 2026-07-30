<?php

use Illuminate\Support\Facades\Http;

it('forwards form submissions to kestra through the backend endpoint', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');
    config()->set('services.kestra.default_lead_source', 'Google');

    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => true,
            'route_to_whatsapp' => true,
            'reason' => 'qualified',
            'message' => 'Califica.',
            'rule_version' => '2026-07-21',
        ], 200),
        'https://kestra.example.test/webhook' => Http::response([
            'ok' => true,
            'action' => 'created',
            'reason' => 'created',
            'message' => 'Lead creado.',
            'lead_id' => '202',
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
    ]);

    Http::assertSent(function ($request) {
        $data = $request->data();

        return $request->url() === 'https://kestra.example.test/webhook'
            && $data['cuil'] === '20-12345678-3'
            && $data['email'] === 'juan.perez@example.com'
            && $data['whatsapp'] === '3511234567'
            && $data['province'] === 'Córdoba'
            && $data['employment_status'] === 'Policia'
            && $data['payment_bank'] === 'Banco de la Nacion Argentina'
            && $data['landing_slug'] === '/prestamos-para-policias'
            && $data['lead_source'] === 'Google'
            && $data['full_name'] === 'Juan Perez';
    });

    Http::assertSent(fn ($request) => $request->url() === 'https://kestra.example.test/prequalification'
        && $request['province'] === 'Córdoba'
        && $request['employment_status'] === 'Policia'
        && $request['payment_bank'] === 'Banco de la Nacion Argentina');
});

it('requires the landing slug to submit the form', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Http::fake();

    $response = $this->postJson('/api/form-submissions', [
        'email' => 'juan.perez@example.com',
        'terminos' => true,
    ]);

    $response->assertUnprocessable()->assertJsonValidationErrors(['landing_slug']);

    Http::assertNothingSent();
});

it('returns not qualified only after the lead was loaded successfully', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => false,
            'reason' => 'payment_bank_not_eligible',
            'message' => 'El banco no califica.',
        ]),
        'https://kestra.example.test/webhook' => Http::response([
            'ok' => true,
            'lead_id' => '203',
            'action' => 'created',
        ]),
    ]);

    $response = $this->postJson('/api/form-submissions', validFormPayload());

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => false,
        'reason' => 'payment_bank_not_eligible',
        'lead_id' => '203',
    ]);
});

it('shows a neutral no-ok result when prequalification fails but loading succeeds', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response(['ok' => false], 503),
        'https://kestra.example.test/webhook' => Http::response([
            'ok' => true,
            'lead_id' => '204',
            'action' => 'created',
        ]),
    ]);

    $response = $this->postJson('/api/form-submissions', validFormPayload());

    $response->assertOk()->assertJson([
        'ok' => true,
        'qualified' => false,
        'reason' => 'prequalification_unavailable',
        'lead_id' => '204',
    ]);
});

it('returns a technical error when loading fails even if prequalification succeeds', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');

    Http::fake([
        'https://kestra.example.test/prequalification' => Http::response([
            'ok' => true,
            'prequalified' => true,
        ]),
        'https://kestra.example.test/webhook' => Http::response(['ok' => false], 500),
    ]);

    $response = $this->postJson('/api/form-submissions', validFormPayload());

    $response->assertStatus(500)->assertJson([
        'ok' => false,
        'qualified' => false,
        'reason' => 'form_load_failed',
    ]);
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
