<?php

use App\Models\Regulator;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;

it('shows the Fiat convention card using the active regulator linked by short name', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://fiat.example.test');

    Regulator::create([
        'name' => 'Asociación Mutual Fiat Concord',
        'short_name' => 'fiat_celesol',
        'logo_path' => 'regulators/fiat.png',
        'inaes_mat' => '233',
        'bcra_code' => '55277',
        'cuit' => '30-62415628-1',
        'is_active' => true,
        'sort_order' => 1,
    ]);

    Http::fake([
        'https://fiat.example.test/api/redunisol/finSolicitud/0/228418' => Http::response([
            'montoAfinanciar' => '$ 100.000,00',
            'cuotaResultante' => '25000,50',
            'nombreSocio' => 'Juan Perez',
            'cuotas' => '6',
        ], 200),
    ]);

    $this->get('/finalizar.php?sol=228418&ntrans=0&linea=fiat_celesol')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.regulator.short_name', 'fiat_celesol')
            ->where('finalizar.regulator.name', 'Asociación Mutual Fiat Concord')
            ->where('finalizar.regulator.cuit', '30-62415628-1')
            ->where('finalizar.regulator.inaes_mat', '233')
            ->missing('finalizar.regulator.bcra_code')
            ->where('finalizar.regulator.logo_url', '/storage/regulators/fiat.png')
            ->where('finalizar.metamap.flow_id', '6453f8ecf6fa8c001c7b15e6')
            ->where('finalizar.metamap.doc_id', 'f6aad70e-d611-4efd-a3ee-8b08487e89c4')
        );

    Http::assertSent(fn ($request) => $request->url() === 'https://fiat.example.test/api/redunisol/finSolicitud/0/228418'
        && $request->method() === 'POST');
});

it('does not show a convention card when short_name does not match linea', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://fiat.example.test');

    Regulator::create([
        'name' => 'Asociación Mutual Fiat Concord',
        'short_name' => 'Fiat Concord',
        'is_active' => true,
    ]);

    Http::fake([
        'https://fiat.example.test/api/redunisol/finSolicitud/0/228418' => Http::response([], 200),
    ]);

    $this->get('/finalizar.php?sol=228418&ntrans=0&linea=fiat_celesol')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.regulator', null)
        );
});

it('shows a convention card when the matching regulator is inactive', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://fiat.example.test');

    Regulator::create([
        'name' => 'Asociación Mutual Fiat Concord',
        'short_name' => 'fiat_celesol',
        'is_active' => false,
    ]);

    Http::fake([
        'https://fiat.example.test/api/redunisol/finSolicitud/0/228418' => Http::response([], 200),
    ]);

    $this->get('/finalizar.php?sol=228418&ntrans=0&linea=fiat_celesol')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.regulator.short_name', 'fiat_celesol')
            ->where('finalizar.regulator.name', 'Asociación Mutual Fiat Concord')
            ->where('finalizar.metamap.flow_id', '6453f8ecf6fa8c001c7b15e6')
        );
});

it('uses the same convention card data shape for a future configured line', function () {
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://caja.example.test');
    config()->set('finalizar.lines.futura', [
        'flow_id' => 'future-flow-id',
        'doc_id' => 'future-doc-id',
        'extra_html' => '',
    ]);

    Regulator::create([
        'name' => 'Asociación Mutual Futura',
        'short_name' => 'Futura',
        'inaes_mat' => '999',
        'bcra_code' => '88888',
        'cuit' => '30-00000000-0',
        'is_active' => true,
    ]);

    Http::fake([
        'https://caja.example.test/api/redunisol/finSolicitud/0/123' => Http::response([], 200),
    ]);

    $this->get('/finalizar.php?sol=123&ntrans=0&linea=futura')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('finalizar')
            ->where('finalizar.regulator.short_name', 'Futura')
            ->where('finalizar.regulator.name', 'Asociación Mutual Futura')
            ->where('finalizar.regulator.cuit', '30-00000000-0')
            ->where('finalizar.regulator.inaes_mat', '999')
            ->where('finalizar.regulator.logo_url', null)
            ->where('finalizar.metamap.flow_id', 'future-flow-id')
            ->where('finalizar.metamap.doc_id', 'future-doc-id')
        );
});

it('uses linea from the URL as the source of truth for the convention card', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://caja.example.test');

    Regulator::create([
        'name' => 'Asociación Mutual Cliente Nuevo',
        'short_name' => 'cliente_nuevo',
        'is_active' => true,
    ]);

    Http::fake([
        'https://caja.example.test/api/redunisol/finSolicitud/0/321' => Http::response([], 200),
    ]);

    $this->get('/finalizar.php?sol=321&ntrans=0&linea=cliente_nuevo')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('finalizar.linea', 'caja')
            ->where('finalizar.regulator.short_name', 'cliente_nuevo')
            ->where('finalizar.regulator.name', 'Asociación Mutual Cliente Nuevo')
        );
});

it('does not resolve Fiat convention data for Caja or unknown lines', function () {
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://caja.example.test');

    Regulator::create([
        'name' => 'Asociación Mutual Fiat Concord',
        'short_name' => 'fiat_celesol',
        'is_active' => true,
    ]);

    Http::fake([
        'https://caja.example.test/api/redunisol/finSolicitud/*' => Http::response([], 200),
    ]);

    $this->get('/finalizar.php?sol=1&ntrans=0&linea=caja')
        ->assertInertia(fn (Assert $page) => $page->where('finalizar.regulator', null));

    $this->get('/finalizar.php?sol=2&ntrans=0&linea=desconocida')
        ->assertInertia(fn (Assert $page) => $page
            ->where('finalizar.linea', 'caja')
            ->where('finalizar.regulator', null)
        );
});

it('shows the convenio of the loan and not the one in the url', function () {
    // Mismo problema que con el documento: si la entidad sale de la query, el
    // socio ve el convenio de una mutual y firma el documento de otra.
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.solicitudes.base_url', 'https://solicitudes.example.test');

    Regulator::create([
        'short_name' => 'amejuca',
        'name' => 'Asociacion Mutual Amejuca',
        'cuit' => '30-69517717-45',
        'inaes_mat' => '68',
        'is_active' => true,
        'sort_order' => 1,
    ]);

    Http::fake([
        'https://solicitudes.example.test/api/redunisol/finSolicitud/0/440327' => Http::response([
            'nombreSocio' => 'Ana Gomez',
            'montoAfinanciar' => '$ 250.000,00',
            'cuotaResultante' => '52000,00',
            'cuotas' => '6',
            'linea' => 'amejuca',
        ], 200),
    ]);

    $this->get('/finalizar-nvo?sol=440327&ntrans=0&linea=mudon')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('finalizar.regulator.short_name', 'amejuca')
        );
});

it('finds the convenio of a codigo that is not a config line', function () {
    // Celesol no esta en el array lines, asi que 'linea' normaliza a caja. Si
    // la entidad se buscara por ese valor normalizado, los prestamos de Celesol
    // se quedarian sin tarjeta -- son los 699 de los ultimos seis meses.
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.solicitudes.base_url', 'https://solicitudes.example.test');

    Regulator::create([
        'short_name' => 'Celesol',
        'name' => 'Asociacion Mutual Celesol',
        'cuit' => '30-11111111-1',
        'inaes_mat' => '1',
        'is_active' => true,
        'sort_order' => 1,
    ]);

    Http::fake([
        'https://solicitudes.example.test/api/redunisol/finSolicitud/0/440327' => Http::response([
            'nombreSocio' => 'Ana Gomez',
            'montoAfinanciar' => '$ 250.000,00',
            'cuotaResultante' => '52000,00',
            'cuotas' => '6',
            'linea' => 'Celesol',
        ], 200),
    ]);

    $this->get('/finalizar-nvo?sol=440327&ntrans=0')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('finalizar.linea', 'caja')
            ->where('finalizar.regulator.short_name', 'Celesol')
        );
});

it('keeps using the url linea for the convenio on the legacy route', function () {
    // Vimarx no devuelve el codigo, asi que el circuito de siempre no cambia.
    config()->set('finalizar.metamap.client_id', 'public-client-id');
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://caja.example.test');

    Regulator::create([
        'short_name' => 'mudon',
        'name' => 'Mutual de Docentes del Neuquen',
        'cuit' => '30-62556738-2',
        'inaes_mat' => '33',
        'is_active' => true,
        'sort_order' => 1,
    ]);

    Http::fake([
        'https://caja.example.test/api/redunisol/finSolicitud/0/249493' => Http::response([
            'nombreSocio' => 'Juan Perez',
            'montoAfinanciar' => '$ 500.000,00',
            'cuotaResultante' => '164996,06',
            'cuotas' => '6',
        ], 200),
    ]);

    $this->get('/finalizar.php?sol=249493&ntrans=0&linea=mudon')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('finalizar.regulator.short_name', 'mudon')
        );
});
