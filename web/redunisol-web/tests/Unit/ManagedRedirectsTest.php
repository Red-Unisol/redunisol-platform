<?php

use App\Http\Middleware\HandleRedirections;
use App\Services\ManagedRedirects;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

uses(TestCase::class);

dataset('agency redirects', function () {
    $file = fopen(__DIR__.'/../Fixtures/agency-seo-redirects.csv', 'r');
    fgetcsv($file, escape: '');
    $row = 2;
    while (($values = fgetcsv($file, escape: '')) !== false) {
        yield 'htaccess row '.$row++ => $values;
    }
    fclose($file);
});

it('returns the agency destination in one permanent redirect with attribution', function (string $source, string $destination) {
    $parts = parse_url($source);
    $path = str_replace('*', 'css/site.css', $parts['path']);
    $path = implode('/', array_map('rawurlencode', explode('/', rawurldecode($path))));
    $url = $parts['scheme'].'://'.$parts['host'].$path.'?'.($parts['query'] ?? 'utm_source=seo').'&gclid=click%2B123';
    $expected = 'https://redunisol.com.ar'.(rtrim(parse_url($destination, PHP_URL_PATH), '/') ?: '/');

    foreach (['GET', 'HEAD'] as $method) {
        $response = app(HandleRedirections::class)->handle(Request::create($url, $method), function () {
            throw new RuntimeException('The legacy URL was not redirected.');
        });
        expect($response->getStatusCode())->toBe(301);
        $location = $response->headers->get('Location');
        expect(strtok($location, '?'))->toBe($expected);
        parse_str(parse_url($location, PHP_URL_QUERY), $query);
        expect($query['gclid'])->toBe('click+123')
            ->and($query['utm_source'])->toBe(isset($parts['query']) ? 'chatgpt.com' : 'seo');
    }

    expect(app(ManagedRedirects::class)->targetFor('redunisol.com.ar', parse_url($expected, PHP_URL_PATH)))->toBeNull();
})->with('agency redirects');

it('limits historical rules to their source host and directory', function () {
    $rules = app(ManagedRedirects::class);
    expect($rules->targetFor('redunisol.com.ar', '/diferencia-entre-mutual-y-cooperativa'))->toBeNull()
        ->and($rules->targetFor('example.com', '/index.html'))->toBeNull()
        ->and($rules->targetFor('prestamos.redunisol.com.ar', '/wp-content/themes/redunisol-other/style.css'))->toBeNull()
        ->and($rules->targetFor('prestamos.redunisol.com.ar', '/wp-content/themes/redunisol/style.css'))->toBe('https://redunisol.com.ar/')
        ->and($rules->targetFor('www.redunisol.com.ar', '/privacidad/'))->toBe('https://redunisol.com.ar/politicas-de-privacidad')
        ->and($rules->targetFor('redunisol.com.ar', '/privacidad'))->toBe('https://redunisol.com.ar/politicas-de-privacidad')
        ->and($rules->targetFor('dev.redunisol.com.ar', '/prestamos-para-empleados-universidad-nacional-de-cordoba'))->toBe('https://redunisol.com.ar/')
        ->and($rules->targetFor('www.redunisol.com.ar', '/prestamos-para-empleados-universidad-nacional-de-cordoba'))->toBe('https://redunisol.com.ar/blog');
});

it('does not redirect submissions to a legacy URL', function () {
    $response = app(HandleRedirections::class)->handle(
        Request::create('https://redunisol.com.ar/formulariocrm.html', 'POST'),
        fn () => new Response('unchanged', 202),
    );
    expect($response->getStatusCode())->toBe(202)
        ->and($response->getContent())->toBe('unchanged');
});
