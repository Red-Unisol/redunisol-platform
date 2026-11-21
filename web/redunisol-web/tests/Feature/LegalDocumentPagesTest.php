<?php

use App\Models\Redirection;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    config()->set('inertia.ssr.enabled', false);
});

it('serves the supplied document without a CMS page or a historical redirect', function (string $path, string $title, string $pdf) {
    $this->get('https://dev.redunisol.com.ar'.$path)->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('legal-document')
            ->where('document.title', $title)
            ->where('document.pdfUrl', $pdf)
            ->where('document.draft', true)
            ->where('document.content', fn ($content) => str_contains($content, 'Para cerrar el borrador'))
            ->where('seo.robots', 'noindex, nofollow'));
    $this->get('https://redunisol.com.ar'.$path)->assertOk();
    $this->head('https://redunisol.com.ar'.$path)->assertOk();
})->with([
    ['/terminos', 'Términos y Condiciones', '/legal/red-unisol-terminos-y-condiciones.pdf'],
    ['/privacidad', 'Política de Privacidad', '/legal/red-unisol-politica-de-privacidad.pdf'],
]);

it('keeps legal pages reachable despite an old active CMS redirect', function () {
    Redirection::create(['from' => '/terminos', 'to' => '/gestion-de-datos', 'is_active' => true, 'is_external' => false]);
    $this->get('/terminos')->assertOk()->assertInertia(fn (Assert $page) => $page->component('legal-document'));
});

it('keeps former legal URLs working without redirect loops', function (string $source, string $target) {
    $this->get($source)->assertStatus(301)->assertRedirect($target);
    $this->get($target)->assertOk();
})->with([
    ['/politicas-de-privacidad', '/privacidad'],
    ['/terminos-y-condiciones', '/terminos'],
]);
