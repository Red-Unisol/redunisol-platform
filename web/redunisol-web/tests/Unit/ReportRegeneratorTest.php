<?php

use App\Support\ReportRegenerator;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config([
        'reports.kestra_url' => 'https://kestra.test',
        'reports.kestra_tenant' => 'main',
        'reports.kestra_username' => 'reports-user',
        'reports.kestra_password' => 'reports-password',
        'reports.namespace_prefix' => 'redunisol.prod',
    ]);
    Cache::flush();
    Http::preventStrayRequests();
});

test('each report starts its own allowlisted flow asynchronously', function (string $key, string $domain, string $flow) {
    Http::fake(['kestra.test/*' => Http::response(['id' => 'execution-1234567890'])]);

    $state = app(ReportRegenerator::class)->start($key);

    expect($state['busy'])->toBeTrue();
    Http::assertSent(fn ($request) => $request->method() === 'POST'
        && $request->url() === 'https://kestra.test/api/v1/main/executions/redunisol.prod.'.$domain.'/'.$flow
        && $request->hasHeader('Authorization', 'Basic '.base64_encode('reports-user:reports-password')));
    Http::assertSentCount(1);
})->with([
    ['analisis-credito/reporte-evaluacion', 'analisis-credito', 'reporte_evaluacion_management'],
    ['analisis-credito/reporte-evaluacion-comisiones', 'analisis-credito', 'reporte_evaluacion_comisiones_management'],
    ['analisis-credito/tope-descuento-caja', 'analisis-credito', 'tope_descuento_caja_mensual'],
    ['cobranzas/mudon-jubilados', 'analisis-credito', 'mudon_credixsa_report'],
    ['contabilidad/transferencias-app', 'contabilidad', 'transfer_trace_report_daily'],
    ['marketing/distribucion-negociaciones', 'marketing-crm', 'commercial_distribution_report_daily'],
    ['marketing/formulario-bitrix', 'marketing-crm', 'form_management_report_daily'],
]);

test('an active generation cannot be started again and becomes available when it finishes', function () {
    Http::fake([
        '*/executions/execution-1234567890' => Http::sequence()
            ->push(['state' => ['current' => 'RUNNING']])
            ->push(['state' => ['current' => 'SUCCESS'], 'outputs' => ['ok' => true]]),
        '*/executions/*' => Http::response(['id' => 'execution-1234567890']),
    ]);
    $service = app(ReportRegenerator::class);
    $service->start('marketing/formulario-bitrix');
    $service->start('marketing/formulario-bitrix');
    Http::assertSentCount(2);

    expect($service->status('marketing/formulario-bitrix')['busy'])->toBeFalse();
    $service->start('marketing/formulario-bitrix');
    Http::assertSentCount(4);
});

test('unknown reports cannot choose arbitrary flows', function () {
    Http::fake();
    try {
        app(ReportRegenerator::class)->start('../marketing/other-flow');
        test()->fail('Expected an HTTP exception');
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(404);
    }
    Http::assertNothingSent();
});

test('a lost start response is not retried and temporarily blocks duplicate requests', function () {
    Http::fake(['kestra.test/*' => Http::failedConnection()]);
    $service = app(ReportRegenerator::class);
    try {
        $service->start('marketing/formulario-bitrix');
        test()->fail('Expected a connection error');
    } catch (ConnectionException) {
        expect($service->status('marketing/formulario-bitrix')['state'])->toBe('UNKNOWN');
    }
    expect($service->start('marketing/formulario-bitrix')['state'])->toBe('UNKNOWN');
    $this->travel(121)->seconds();
    expect($service->status('marketing/formulario-bitrix')['busy'])->toBeFalse();
});

test('business failures unlock the button without reporting success', function () {
    Http::fake([
        '*/executions/execution-1234567890' => Http::response(['state' => ['current' => 'SUCCESS'], 'outputs' => ['ok' => false]]),
        '*/executions/*' => Http::response(['id' => 'execution-1234567890']),
    ]);
    $service = app(ReportRegenerator::class);
    $service->start('marketing/formulario-bitrix');

    expect($service->status('marketing/formulario-bitrix'))
        ->toMatchArray(['busy' => false, 'state' => 'FAILED']);
});
