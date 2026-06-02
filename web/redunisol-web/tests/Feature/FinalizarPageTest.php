<?php

use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;

it('loads legacy finalizar urls and resolves caja loan data server side', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://caja.example.test');

    Http::fake([
        'https://caja.example.test/api/redunisol/finSolicitud/0/228418' => Http::response([
            'montoAfinanciar' => '$ 100.000,00',
            'cuotaResultante' => '25000,50',
            'nombreSocio' => 'Juan Perez',
            'cuotas' => '6',
            'prestamoCFT' => '3.20',
            'prestamoTEM' => '0.10',
            'prestamoTNA' => '2.95',
            'prestamoTEA' => '18.30',
            'NumeroPrestamo' => '9001',
            'CapitalOriginal' => '100000.00',
            'MontoPrestamo' => '150003.00',
            'PrimerVencimiento' => '2026-06-10T00:00:00',
            'Vencimiento' => '2026-11-10T00:00:00',
        ], 200),
    ]);

    $this->get('/finalizar.php?sol=228418&ntrans=0&linea=caja')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.loan.solicitud', '228418')
            ->where('finalizar.loan.nombre', 'Juan Perez')
            ->where('finalizar.loan.monto_total_display', '$ 100.000,00')
            ->where('finalizar.loan.monto_cuota_display', '$ 25.000,50')
            ->where('finalizar.loan.prestamo_tna', '295.00')
            ->where('finalizar.metamap.client_id', 'public-client-id')
            ->where('finalizar.metamap.flow_id', '66143f63a6c0b9001c9d8e57')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey.value', '228418')
        );

    Http::assertSent(fn ($request) => $request->url() === 'https://caja.example.test/api/redunisol/finSolicitud/0/228418'
        && $request->method() === 'POST');
});

it('uses the default metamap flow when the requested line does not match', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://caja.example.test');

    Http::fake([
        'https://caja.example.test/api/redunisol/finSolicitud/0/245756' => Http::response([
            'montoAfinanciar' => '$ 80.000,00',
            'cuotaResultante' => '12000,00',
            'nombreSocio' => 'Maria Lopez',
            'cuotas' => '8',
            'prestamoCFT' => '2.50',
            'prestamoTEM' => '0.08',
            'prestamoTNA' => '2.10',
            'prestamoTEA' => '15.50',
            'NumeroPrestamo' => '8001',
            'CapitalOriginal' => '80000.00',
            'MontoPrestamo' => '96000.00',
            'PrimerVencimiento' => '2026-07-10T00:00:00',
            'Vencimiento' => '2027-02-10T00:00:00',
        ], 200),
    ]);

    $this->get('/finalizar.php?sol=245756&ntrans=0&linea=Celesol')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.linea', 'caja')
            ->where('finalizar.loan.solicitud', '245756')
            ->where('finalizar.metamap.flow_id', '6453e19ef6fa8c001c7af03e')
            ->where('finalizar.metamap.doc_id', 'e51bc831-5b64-417b-9f9d-ac9167317590')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey.value', '245756')
        );

    Http::assertSent(fn ($request) => $request->url() === 'https://caja.example.test/api/redunisol/finSolicitud/0/245756'
        && $request->method() === 'POST');
});

it('maps its solicitudes and infers the metamap line', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.its.base_url', 'https://its.example.test');
    config()->set('finalizar.its.api_key', 'test-api-key');
    config()->set('finalizar.its.user', 'test-user');
    config()->set('finalizar.its.password', 'test-password');

    Http::fake([
        'https://its.example.test/apis/gettoken' => Http::response(['token' => 'token-123'], 200),
        'https://its.example.test/apis/getsolicitud/123' => Http::response([
            'solicitud' => [
                'ayt_nombre' => 'Caja Sanatorio',
                'ayt_emp_id' => 1003,
                'ayu_neto' => 120000,
                'ayu_capital' => 150000,
                'ayu_gastos_originacion' => 1500,
                'ayu_valor_cuota' => 30000,
                'ayu_cant_cuotas' => 5,
                'ayu_tna' => 2.4,
                'ayu_fecha_vencimiento' => '2026-06-15',
                'ayu_nro_comprobante' => 'ITS-555',
                'per_nombre' => 'Ana',
                'per_apellido' => 'Gomez',
            ],
        ], 200),
    ]);

    $this->get('/finalizar?sol=123&linea=its')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.linea', 'sanatorio_caja')
            ->where('finalizar.loan.nombre', 'Ana Gomez')
            ->where('finalizar.loan.monto_total_display', '$ 120.000,00')
            ->where('finalizar.loan.monto_cuota_display', '$ 30.000,00')
            ->where('finalizar.loan.numero_prestamo', 'ITS-555')
            ->where('finalizar.metamap.flow_id', '6926ffc1bea61b3cf126e67e')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey12.value', '2026-06-15')
        );
});

it('does not expose legacy api credentials in inertia props', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', '');

    $response = $this->get('/finalizar?sol=1&linea=caja');

    $response->assertOk();
    $response->assertDontSee('FINALIZAR_API_USER');
    $response->assertDontSee('test-password');
});
