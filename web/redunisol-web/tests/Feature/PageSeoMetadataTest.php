<?php

use App\Models\Page;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    config()->set('app.url', 'https://redunisol.example.test');
    config()->set('inertia.ssr.enabled', false);
});

it('renders one stable noindex canonical for a configured test page', function () {
    Page::create([
        'title' => 'Préstamos para jubilados de Córdoba',
        'slug' => '/landing-prueba',
        'index' => false,
        'canonical_url' => '/prestamos-para-jubilados/jubilados-cordoba',
        'sections' => [],
    ]);

    $response = $this->get('/landing-prueba?utm_source=meta&utm_campaign=form-abajo');

    $response->assertOk();
    $html = $response->getContent();

    expect(substr_count($html, 'name="robots"'))->toBe(1)
        ->and($html)->toContain('inertia="robots" name="robots" content="noindex, nofollow"')
        ->and(substr_count($html, 'rel="canonical"'))->toBe(1)
        ->and($html)->toContain('href="https://redunisol.example.test/prestamos-para-jubilados/jubilados-cordoba"')
        ->and($html)->not->toContain('canonical" href="https://redunisol.example.test/landing-prueba')
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

it('serves the Cordoba variant directly with its own form and the canonical landing metadata', function () {
    $canonical = '/prestamos-para-jubilados/jubilados-cordoba';
    $variant = $canonical.'/form-abajo';

    Page::create([
        'title' => 'Landing original',
        'slug' => $canonical,
        'sections' => [['type' => 'form', 'data' => []]],
    ]);
    Page::create([
        'title' => 'Variante Córdoba',
        'slug' => $variant,
        'index' => false,
        'canonical_url' => $canonical,
        'sections' => [
            ['type' => 'hero', 'data' => ['title' => 'Jubilados de Córdoba']],
            ['type' => 'form', 'data' => ['provincia' => ['enabled' => false, 'defaultValue' => 'Córdoba']]],
            ['type' => 'faqs', 'data' => []],
        ],
    ]);

    $this->get($variant.'?utm_source=meta&gclid=click%2B123')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('welcome')
            ->where('landingSlug', $variant)
            ->where('formAtBottom', true)
            ->where('sections.1.data.provincia.defaultValue', 'Córdoba')
            ->where('seo.canonical', 'https://redunisol.example.test'.$canonical)
            ->where('seo.robots', 'noindex, nofollow'));
    $this->head($variant)->assertOk();
    $this->get($canonical)->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('welcome')
            ->where('landingSlug', $canonical)
            ->where('formAtBottom', false));
});
