<?php

use Illuminate\Support\Facades\Http;

it('forwards form submissions to kestra through the backend endpoint', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');
    config()->set('services.kestra.default_lead_source', 'Google');

    Http::fake([
        'https://kestra.example.test/webhook' => Http::response([
            'ok' => true,
            'qualified' => true,
            'action' => 'qualified',
            'reason' => 'qualified',
            'message' => 'ok',
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
});

it('requires the landing slug to submit the form', function () {
    config()->set('services.kestra.form_webhook_url', 'https://kestra.example.test/webhook');

    Http::fake();

    $response = $this->postJson('/api/form-submissions', [
        'email' => 'juan.perez@example.com',
        'terminos' => true,
    ]);

    $response->assertUnprocessable()->assertJsonValidationErrors(['landing_slug']);

    Http::assertNothingSent();
});