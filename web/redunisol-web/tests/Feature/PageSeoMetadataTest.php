<?php

use App\Models\Page;

beforeEach(function () {
    $this->withoutVite();
    config()->set('app.url', 'https://redunisol.example.test');
    config()->set('inertia.ssr.enabled', false);
});

it('renders one stable noindex canonical for the Cordoba test variant', function () {
    Page::create([
        'title' => 'Préstamos para jubilados de Córdoba',
        'slug' => '/prestamos-para-jubilados/jubilados-cordoba/form-abajo',
        'index' => false,
        'canonical_url' => '/prestamos-para-jubilados/jubilados-cordoba',
        'sections' => [],
    ]);

    $response = $this->get('/prestamos-para-jubilados/jubilados-cordoba/form-abajo?utm_source=meta&utm_campaign=form-abajo');

    $response->assertOk();
    $html = $response->getContent();

    expect(substr_count($html, 'name="robots"'))->toBe(1)
        ->and($html)->toContain('inertia="robots" name="robots" content="noindex, nofollow"')
        ->and(substr_count($html, 'rel="canonical"'))->toBe(1)
        ->and($html)->toContain('href="https://redunisol.example.test/prestamos-para-jubilados/jubilados-cordoba"')
        ->and($html)->not->toContain('canonical" href="https://redunisol.example.test/prestamos-para-jubilados/jubilados-cordoba/form-abajo')
        ->and($html)->not->toContain('canonical" href="https://redunisol.example.test/prestamos-para-jubilados/jubilados-cordoba?utm_');
});

it('keeps noindex pages out of the sitemap while including the canonical page', function () {
    Page::create([
        'title' => 'Landing original',
        'slug' => '/prestamos-para-jubilados/jubilados-cordoba',
        'index' => true,
        'sections' => [],
    ]);
    Page::create([
        'title' => 'Variante',
        'slug' => '/prestamos-para-jubilados/jubilados-cordoba/form-abajo',
        'index' => false,
        'canonical_url' => '/prestamos-para-jubilados/jubilados-cordoba',
        'sections' => [],
    ]);

    $response = $this->get('/sitemap.xml');

    $response->assertOk()
        ->assertSee('https://redunisol.example.test/prestamos-para-jubilados/jubilados-cordoba', false)
        ->assertDontSee('https://redunisol.example.test/prestamos-para-jubilados/jubilados-cordoba/form-abajo', false);
});
