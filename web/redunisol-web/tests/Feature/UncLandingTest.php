<?php

use App\Models\Page;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    config()->set('app.url', 'https://redunisol.com.ar');
    config()->set('inertia.ssr.enabled', false);
});

it('serves the approved UNC commercial landing on both public hosts', function (string $host) {
    $slug = '/prestamos-para-empleados-universidad-nacional-de-cordoba';
    $title = 'Préstamos para empleados UNC y DASPU';
    $canonical = 'https://redunisol.com.ar'.$slug;

    Page::create([
        'title' => $title,
        'slug' => $slug,
        'canonical_url' => $canonical,
        'index' => true,
        'sections' => [],
    ]);

    $url = 'https://'.$host.$slug.'?utm_source=google&gclid=unc-test';
    $this->get($url)
        ->assertOk()
        ->assertHeaderMissing('Location')
        ->assertInertia(fn (Assert $page) => $page
            ->component('welcome')
            ->where('landingSlug', $slug)
            ->where('title', $title)
            ->where('seo.canonical', $canonical));

    $this->head($url)->assertOk()->assertHeaderMissing('Location');
})->with(['redunisol.com.ar', 'www.redunisol.com.ar']);
