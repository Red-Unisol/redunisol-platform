<?php

use App\Models\Blog;
use App\Models\Page;
use App\Models\User;
use Inertia\Ssr\Gateway;
use Inertia\Ssr\Response as SsrResponse;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    config()->set('app.name', 'Red Unisol');
    config()->set('app.url', 'https://redunisol.example.test');
    config()->set('inertia.ssr.enabled', false);
});

it('serves the configured metadata once in the initial HTML without requiring JavaScript', function (string $title, string $expected) {
    Page::create([
        'title' => 'Landing', 'slug' => '/landing', 'meta_title' => $title,
        'meta_description' => 'Descripción específica de la landing.',
        'keyword' => 'créditos', 'index' => true, 'sections' => [],
    ]);

    $html = $this->get('/landing?utm_source=google')->assertOk()->getContent();
    $dom = new DOMDocument;
    @$dom->loadHTML('<?xml encoding="UTF-8">'.$html);
    $xpath = new DOMXPath($dom);
    expect($xpath->query('//title'))->toHaveCount(1)
        ->and($xpath->evaluate('string(//title)'))->toBe($expected);
    foreach (['description', 'twitter:description', 'twitter:title', 'twitter:image', 'robots', 'viewport'] as $name) {
        expect($xpath->query('//meta[@name="'.$name.'"]'))->toHaveCount(1);
    }
    foreach (['og:title', 'og:description', 'og:image', 'og:type', 'og:site_name', 'og:url'] as $property) {
        expect($xpath->query('//meta[@property="'.$property.'"]'))->toHaveCount(1);
    }
    expect($xpath->evaluate('string(//meta[@name="description"]/@content)'))->toBe('Descripción específica de la landing.')
        ->and($xpath->evaluate('string(//meta[@property="og:title"]/@content)'))->toBe($expected)
        ->and($xpath->evaluate('string(//meta[@name="twitter:description"]/@content)'))->toBe('Descripción específica de la landing.')
        ->and($xpath->evaluate('string(//link[@rel="canonical"]/@href)'))->toBe('https://redunisol.example.test/landing');
})->with([
    ['Créditos Córdoba', 'Créditos Córdoba | Red Unisol'],
    ['Créditos Córdoba | Red Unisol', 'Créditos Córdoba | Red Unisol'],
    ['Créditos Córdoba | RED UNISOL', 'Créditos Córdoba | RED UNISOL'],
]);

it('does not add fallback tags when the SSR response already contains them', function () {
    Page::create(['title' => 'Landing', 'slug' => '/landing', 'index' => true, 'sections' => []]);
    $head = '<title inertia>Landing SSR | Red Unisol</title><meta inertia="description" name="description" content="SSR description">';
    $this->mock(Gateway::class)->shouldReceive('dispatch')->once()->andReturn(new SsrResponse($head, '<div id="app">SSR</div>'));

    $html = $this->get('/landing')->assertOk()->getContent();
    expect(substr_count($html, '<title'))->toBe(1)
        ->and(substr_count($html, 'name="description"'))->toBe(1)
        ->and($html)->toContain($head);
});

it('provides metadata for the blog index and published articles', function () {
    $this->get('/blog')->assertOk()->assertInertia(fn (Assert $page) => $page
        ->component('blog/index')->where('seo.metaTitle', 'Blog | Red Unisol'));
    Blog::create([
        'title' => 'Guía', 'slug' => 'guia', 'content' => '<p>Contenido</p>',
        'author_id' => User::factory()->create()->id,
        'meta_title' => 'Guía de créditos', 'meta_description' => 'Descripción del artículo.',
        'index' => true, 'published_at' => now()->subDay(),
    ]);
    $this->get('/blog/guia')->assertOk()->assertInertia(fn (Assert $page) => $page
        ->component('blog/show')->where('seo.metaTitle', 'Guía de créditos | Red Unisol')
        ->where('seo.metaDescription', 'Descripción del artículo.')->where('seo.ogType', 'article'));
});

it('redirects retired Cordoba paths directly to the existing landing, preserving attribution', function (string $path) {
    $target = '/prestamos-para-jubilados/jubilados-cordoba';
    Page::create(['title' => 'Córdoba', 'slug' => $target, 'index' => true, 'sections' => []]);
    $response = $this->get($path.'?utm_source=meta&gclid=click%2B123');
    $response->assertStatus(301);
    $location = $response->headers->get('Location');
    expect(parse_url($location, PHP_URL_PATH))->toBe($target);
    parse_str(parse_url($location, PHP_URL_QUERY), $query);
    expect($query)->toBe(['gclid' => 'click+123', 'utm_source' => 'meta']);
    $this->get($location)->assertOk();
    $this->head($path)->assertStatus(301)->assertRedirect($target);
})->with([
    '/jubilados-de-cordoba',
    '/jubilados-de-cordoba/form-abajo',
    '/prestamos-para-jubilados/jubilados-cordoba/form-abajo',
]);

it('excludes retired paths from the sitemap even if their CMS pages are still indexed', function () {
    Page::create(['title' => 'Variante retirada', 'slug' => '/jubilados-de-cordoba/form-abajo', 'index' => true, 'sections' => []]);
    $this->get('/sitemap.xml')->assertOk()->assertDontSee('/jubilados-de-cordoba/form-abajo');
});

it('excludes agency redirects from the canonical sitemap without hiding other hosts current pages', function () {
    config()->set('app.url', 'https://redunisol.com.ar');
    Page::create(['title' => 'Privacidad anterior', 'slug' => '/privacidad', 'index' => true, 'sections' => []]);
    Page::create(['title' => 'Página actual', 'slug' => '/diferencia-entre-mutual-y-cooperativa', 'index' => true, 'sections' => []]);
    $this->get('/sitemap.xml')->assertOk()
        ->assertDontSee('https://redunisol.com.ar/privacidad', false)
        ->assertSee('https://redunisol.com.ar/diferencia-entre-mutual-y-cooperativa', false);
});

it('redirects legacy requests through the Laravel HTTP stack', function (string $url, string $destination) {
    $this->get($url)->assertStatus(301)->assertRedirect($destination);
})->with([
    ['https://www.redunisol.com.ar/privacidad/', 'https://redunisol.com.ar/politicas-de-privacidad'],
    ['https://redunisol.com.ar/celesol/Terminos%20y%20condiciones%20Celesol.pdf', 'https://redunisol.com.ar/gestion-de-datos'],
    ['https://prestamos.redunisol.com.ar/wp-content/themes/redunisol/css/old.css', 'https://redunisol.com.ar/'],
    ['https://prestamos.redunisol.com.ar/diferencia-entre-mutual-y-cooperativa/', 'https://redunisol.com.ar/blog/diferencia-entre-mutual-y-cooperativa'],
]);
