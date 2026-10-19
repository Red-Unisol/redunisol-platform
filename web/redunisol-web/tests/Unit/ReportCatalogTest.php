<?php

use App\Support\ReportCatalog;

test('it groups current and historical files into report cards', function () {
    $reports = collect([
        fakeReport('marketing/formulario-bitrix/historico/2026-09-07.xlsx', 3000),
        fakeReport('contabilidad/transferencias-app/ultimo.xlsx', 2500),
        fakeReport('marketing/formulario-bitrix/ultimo.xlsx', 2000),
        fakeReport('marketing/formulario-bitrix/historico/2026-09-06.xlsx', 1000),
    ]);

    $groups = (new ReportCatalog)->groups($reports);

    expect($groups)->toHaveCount(2)
        ->and($groups->first()['key'])->toBe('contabilidad/transferencias-app')
        ->and($groups->last()['title'])->toBe('Formulario Bitrix')
        ->and($groups->last()['latest']['name'])->toBe('ultimo.xlsx')
        ->and($groups->last()['history'])->toHaveCount(2);
});

test('it gives unknown report folders readable fallback metadata', function () {
    $group = (new ReportCatalog)->groups(collect([
        fakeReport('operaciones/reporte-nuevo/ultimo.csv', 1000),
    ]))->first();

    expect($group['area'])->toBe('Operaciones')
        ->and($group['title'])->toBe('Reporte Nuevo')
        ->and($group['description'])->toBe('Archivos disponibles para este reporte.');
});

test('it groups files from the reports root under general', function () {
    $group = (new ReportCatalog)->groups(collect([
        fakeReport('resumen.pdf', 1000),
    ]))->first();

    expect($group['key'])->toBe('general')
        ->and($group['area'])->toBe('General');
});

function fakeReport(string $path, int $modifiedAt): array
{
    return [
        'name' => basename($path),
        'path' => $path,
        'group' => str_replace('/', ' / ', dirname($path)),
        'size' => 1024,
        'modified_at' => $modifiedAt,
    ];
}

test('it keeps evaluation and commissions as separate report cards', function () {
    $groups = (new ReportCatalog)->groups(collect([
        fakeReport('analisis-credito/reporte-evaluacion/ultimo.xlsx', 1000),
        fakeReport('analisis-credito/reporte-evaluacion-comisiones/ultimo.xlsx', 2000),
        fakeReport('analisis-credito/reporte-evaluacion-comisiones/historico/run.xlsx', 1900),
    ]))->keyBy('key');

    expect($groups)->toHaveCount(2)
        ->and($groups['analisis-credito/reporte-evaluacion']['title'])->toBe('Reporte de evaluación')
        ->and($groups['analisis-credito/reporte-evaluacion']['history'])->toHaveCount(0)
        ->and($groups['analisis-credito/reporte-evaluacion-comisiones']['title'])->toBe('Evaluación y comisiones')
        ->and($groups['analisis-credito/reporte-evaluacion-comisiones']['history'])->toHaveCount(1);
});

test('download names identify the report and the generation date in Argentina', function () {
    $report = fakeReport('analisis-credito/tope-descuento-caja/ultimo.xlsx', strtotime('2026-10-19T02:30:00Z'));
    $catalog = new ReportCatalog;

    expect($catalog->downloadName($report))->toBe('tope-de-descuento-de-caja-2026-10-18_233000.xlsx')
        ->and($catalog->groups(collect([$report]))->first()['latest']['download_name'])
        ->toBe($catalog->downloadName($report));
});

test('historical download names preserve the period and identify the report', function () {
    expect((new ReportCatalog)->downloadName(fakeReport('marketing/formulario-bitrix/historico/2026-09-07.xlsx', 1000)))
        ->toBe('formulario-bitrix-2026-09-07.xlsx');
});

test('only known reports can be regenerated', function () {
    $catalog = new ReportCatalog;
    expect($catalog->definition('analisis-credito/tope-descuento-caja')['flow'])->toBe('tope_descuento_caja_mensual')
        ->and($catalog->definition('cobranzas/mudon-jubilados')['domain'])->toBe('analisis-credito')
        ->and($catalog->definition('operaciones/desconocido'))->toBeNull();
});
