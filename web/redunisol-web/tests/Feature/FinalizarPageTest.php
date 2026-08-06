<?php

use App\Models\SiteSetting;
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
            ->where('finalizar.loan.cuotas', '6')
            ->where('finalizar.loan.prestamo_cft', '320.00')
            ->where('finalizar.loan.prestamo_tem', '10.00')
            ->where('finalizar.loan.prestamo_tna', '295.00')
            ->where('finalizar.loan.prestamo_tea', '1830.00')
            ->where('finalizar.metamap.client_id', 'public-client-id')
            ->where('finalizar.metamap.flow_id', '66143f63a6c0b9001c9d8e57')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey.value', '228418')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey2.value', '$ 100.000,00')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey3.value', '6')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey4.value', '$ 25.000,50')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey5.value', '295.00%')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey6.value', '1830.00%')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey7.value', '320.00%')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey8.value', '10.00%')
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
    config()->set('finalizar.its.api_key', 'private-api-key');
    config()->set('finalizar.its.user', 'private-api-user');
    config()->set('finalizar.its.password', 'private-api-password');

    $response = $this->get('/finalizar?sol=1&linea=caja');

    $response->assertOk();
    $response->assertDontSee('private-api-key');
    $response->assertDontSee('private-api-user');
    $response->assertDontSee('private-api-password');
    $response->assertInertia(fn (Assert $page) => $page
        ->missing('finalizar.credentials')
        ->missing('finalizar.api_key')
        ->missing('finalizar.user')
        ->missing('finalizar.password')
    );
});

it('supports a null loan when no request or fallback data is available', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', '');

    $this->get('/finalizar')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.loan', null)
            ->where('finalizar.metamap.metadata', null)
        );
});

it('supports fallback loans with missing optional data', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', '');

    $this->get('/finalizar?monto=50000&cuotas=3&nro=ABC-123')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.loan.solicitud', 'ABC-123')
            ->where('finalizar.loan.nombre', '')
            ->where('finalizar.loan.monto_total_display', '$ 50.000,00')
            ->where('finalizar.loan.cuotas', '3')
            ->where('finalizar.loan.monto_cuota_display', '')
            ->where('finalizar.loan.prestamo_tna', '')
            ->where('finalizar.loan.prestamo_tea', '')
            ->where('finalizar.loan.prestamo_tem', '')
            ->where('finalizar.loan.prestamo_cft', '')
            ->where('finalizar.metamap.metadata', null)
        );
});

it('uses a hosted pdf as the default terms url', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', '');

    $this->get('/finalizar')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('settings.terms_url', '/terminos-y-condiciones.pdf')
        );
});

it('normalizes the old finalizar terms url to the hosted pdf path', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', '');
    SiteSetting::set('finalizar_terms_url', '/terminos-y-condiciones');

    $this->get('/finalizar')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('settings.terms_url', '/terminos-y-condiciones.pdf')
        );
});

it('keeps the finalizar visual and identity verification contract', function () {
    $page = file_get_contents(resource_path('js/pages/finalizar.tsx'));
    $conventionCard = file_get_contents(resource_path('js/components/convenio-card.tsx'));

    expect($page)
        ->toContain('ACEPTÁ TU CRÉDITO')
        ->toContain('Revisá y aceptá tu crédito')
        ->toContain('Verificá las condiciones de tu crédito antes de')
        ->toContain('Crédito para')
        ->toContain('Monto del crédito')
        ->toContain('Plan de cuotas')
        ->toContain('Número de solicitud')
        ->toContain("createElement('metamap-button'")
        ->toContain('clientid:')
        ->toContain('flowid:')
        ->toContain('metadata,')
        ->toContain("'metamap:userStartedSdk'")
        ->toContain("'metamap:userFinishedSdk'")
        ->toContain("'metamap:exitedSdk'")
        ->toContain("'mati:loaded'")
        ->toContain("'mati:userFinishedSdk'")
        ->toContain("'mati:exitedSdk'")
        ->toContain('Verificar mi identidad y continuar')
        ->toContain('Validación no disponible')
        ->toContain('La validación de identidad está en curso.')
        ->toContain('Identidad validada correctamente')
        ->toContain('La validación no fue completada.')
        ->toContain('max-w-2xl')
        ->toContain('bottom-[calc(0.75rem+env(safe-area-inset-bottom))]')
        ->toContain('sm:static')
        ->toContain('pb-32')
        ->toContain('sm:grid-cols-2')
        ->not->toContain('Al continuar, revisá')
        ->not->toContain('ProgressSteps')
        ->not->toContain('verificationSteps')
        ->not->toContain('Paso 2');

    expect($conventionCard)
        ->toContain('Entidad del convenio')
        ->toContain('Matrícula INAES')
        ->toContain('regulator.logo_url')
        ->toContain('La ayuda económica será descontada de su recibo de sueldo')
        ->toContain('por <strong>{regulator.name}</strong>.')
        ->not->toContain('El crédito será descontado por esta entidad.')
        ->not->toContain('crédito')
        ->not->toContain('RED UNISOL proporciona la infraestructura tecnológica')
        ->not->toContain('Entidad otorgante');
});
