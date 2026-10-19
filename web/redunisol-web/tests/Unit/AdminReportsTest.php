<?php

use App\Filament\Pages\ReportsPage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

beforeEach(function () {
    $directory = storage_path('framework/testing/admin-reports');
    File::ensureDirectoryExists($directory.'/marketing/formulario-bitrix');
    file_put_contents($directory.'/marketing/formulario-bitrix/ultimo.xlsx', 'workbook');
    touch($directory.'/marketing/formulario-bitrix/ultimo.xlsx', strtotime('2026-10-19T12:00:00Z'));
    config([
        'app.key' => 'base64:'.base64_encode(str_repeat('x', 32)),
        'filesystems.reports_path' => $directory,
    ]);
    $this->withoutVite();
    Http::preventStrayRequests();
});

afterEach(function () {
    File::deleteDirectory(storage_path('framework/testing/admin-reports'));
});

test('downloads use descriptive attachment names and remain private', function () {
    $this->actingAs((new User)->forceFill(['id' => 1, 'email' => 'admin@redunisol.local']));

    $this->get(route('admin.reports.download', ['path' => 'marketing/formulario-bitrix/ultimo.xlsx']))
        ->assertOk()->assertDownload('formulario-bitrix-2026-10-19_090000.xlsx');
});

test('guests and non admin accounts cannot download reports', function () {
    $url = route('admin.reports.download', ['path' => 'marketing/formulario-bitrix/ultimo.xlsx']);
    $this->get($url)->assertRedirect();
    $this->actingAs((new User)->forceFill(['id' => 2, 'email' => 'visitor@example.test']));
    $this->get($url)->assertForbidden();
});

test('the report card renders the regenerate action and descriptive filename', function () {
    $this->actingAs((new User)->forceFill(['id' => 1, 'email' => 'admin@redunisol.local']));

    Livewire::test(ReportsPage::class)
        ->assertSee('Regenerar')
        ->assertSee('formulario-bitrix-2026-10-19_090000.xlsx')
        ->assertDontSee('Descargar último');
});

test('the page hides BCRA cards without modifying their files', function () {
    $this->actingAs((new User)->forceFill(['id' => 1, 'email' => 'admin@redunisol.local']));
    $directory = config('filesystems.reports_path');
    $files = [
        'contabilidad/bcra/redunisol.prod.contabilidad/run-id/output/errores.csv',
        'contabilidad/bcra/redunisol.prod.contabilidad/run-id/control/prestamos_tasa.csv',
        'contabilidad/bcra/redunisol.prod.contabilidad/run-id/control/deudores_por_superior.xlsx',
    ];
    foreach ($files as $file) {
        File::ensureDirectoryExists(dirname($directory.'/'.$file));
        file_put_contents($directory.'/'.$file, 'BCRA artifact');
    }

    Livewire::test(ReportsPage::class)
        ->assertSee('Formulario Bitrix')
        ->assertDontSee('Output')
        ->assertDontSee('Control')
        ->assertDontSee('errores.csv')
        ->assertDontSee('prestamos-tasa.csv')
        ->assertDontSee('deudores-por-superior.xlsx');

    foreach ($files as $file) {
        expect(file_get_contents($directory.'/'.$file))->toBe('BCRA artifact');
    }
});

test('non admin accounts cannot invoke regeneration through Livewire', function () {
    $this->actingAs((new User)->forceFill(['id' => 2, 'email' => 'visitor@example.test']));
    Http::fake();
    Livewire::test(ReportsPage::class)->call('regenerate', 'marketing/formulario-bitrix')->assertForbidden();
    Http::assertNothingSent();
});

test('admins can regenerate a report from its card', function () {
    $this->actingAs((new User)->forceFill(['id' => 1, 'email' => 'admin@redunisol.local']));
    config([
        'reports.kestra_url' => 'https://kestra.test',
        'reports.kestra_tenant' => 'main',
        'reports.kestra_username' => 'reports-user',
        'reports.kestra_password' => 'reports-password',
        'reports.namespace_prefix' => 'redunisol.prod',
    ]);
    Cache::flush();
    Http::fake([
        '*/executions/execution-1234567890' => Http::response(['state' => ['current' => 'RUNNING']]),
        '*/executions/*' => Http::response(['id' => 'execution-1234567890']),
    ]);

    Livewire::test(ReportsPage::class)->call('regenerate', 'marketing/formulario-bitrix')
        ->assertSee('Regenerando…')
        ->assertSee('formulario-bitrix-2026-10-19_090000.xlsx');
    Http::assertSent(fn ($request) => $request->method() === 'POST');
});
