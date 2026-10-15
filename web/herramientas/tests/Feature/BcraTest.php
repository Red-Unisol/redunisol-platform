<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class BcraTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        $this->root = sys_get_temp_dir().'/bcra-test-'.Str::uuid();
        File::makeDirectory($this->root, 0755, true);
        config()->set([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'tools.enabled' => true, 'analisis.core_url' => 'https://core.test',
            'analisis.password_hash' => password_hash('test-access', PASSWORD_BCRYPT, ['cost' => 4]),
            'bcra.kestra_url' => 'https://kestra.test', 'bcra.kestra_username' => 'test-operator',
            'bcra.kestra_password' => 'test-secret', 'bcra.namespace' => 'redunisol.dev.contabilidad',
            'bcra.output_root' => $this->root,
            'bcra.excluded_cuits' => [['value' => '20123456786', 'reason' => 'Regla de prueba']],
        ]);
        Cache::flush();
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        // Exact test-owned directory, never a runtime report root.
        $resolved = realpath($this->root);
        $tempRoot = realpath(sys_get_temp_dir());
        if ($resolved !== false && dirname($resolved) === $tempRoot
            && str_starts_with(basename($resolved), 'bcra-test-')
            && Str::isUuid(substr(basename($resolved), strlen('bcra-test-')))) {
            File::deleteDirectory($this->root);
        }
        parent::tearDown();
    }

    private function login(): void
    {
        $this->postJson('/analisis/login', ['password' => 'test-access'])->assertOk();
    }

    private function lines(): array
    {
        return [[10, 'LINEAS NACION', null, null], [11, 'LINEAS TARJETA DE DEBITO', null, null],
            [12, 'DASPU HABERES (830)', null, null], [13, 'LINEAS AMEJUCA CBU', null, null],
            [14, 'LINEAS BANCOR', null, null], [15, 'MUDON HABERES', null, null], [16, 'PRESTAMOS AMORTIZABLES', null, null],
            [20, 'Haberes CUAD SANTA FE', null, null], [21, 'MEDICA PLAN DESENDEUDAMIENTO', 20, 'Haberes CUAD SANTA FE'],
            [22, 'CAJA PLAN DESENDEUDAMIENTO', 20, 'Haberes CUAD SANTA FE'], [23, 'MUCI PLAN DESENDEUDAMIENTO DEC', 20, 'Haberes CUAD SANTA FE'],
            [30, 'LINEA MIS', null, null], [31, 'LINEAS AMES', null, null],
            [40, 'HABERES DESCUENTO POLICIA CBA', null, null]];
    }

    private function inputs(): array
    {
        return ['period' => '2026-07', 'declared_by' => 'Tefi', 'rate' => '112,00',
            'presentation_type' => 'NORMAL', 'granted_without_real_guarantee' => true,
            'selected_line_ids' => ['10'], 'normal_until_66_superior_ids' => ['40'],
            'excluded_cuits' => [], 'excluded_accounts' => []];
    }

    public function test_access_protects_catalog_runs_and_downloads_without_exposing_secrets(): void
    {
        $this->get('/bcra')->assertOk()->assertSee('"authenticated":false', false)
            ->assertDontSee('test-secret')->assertDontSee('https://core.test')->assertDontSee('https://kestra.test');
        foreach (['/api/bcra/catalog', '/api/bcra/runs', '/api/bcra/runs/'.Str::uuid().'/download/zip'] as $url) {
            $this->getJson($url)->assertUnauthorized();
        }
        $this->postJson('/api/bcra/runs', $this->inputs())->assertUnauthorized();
        Http::assertNothingSent();
    }

    public function test_july_v2_defaults_include_reinstated_lines_and_only_exclude_medica_within_cuad(): void
    {
        $this->login();
        Http::fake(['core.test/*' => Http::response($this->lines())]);
        $lines = collect($this->getJson('/api/bcra/catalog')->assertOk()->json('lines'))->keyBy('id');
        foreach (range(10, 16) as $id) {
            $this->assertTrue($lines[(string) $id]['included_by_default']);
        }
        foreach (['21', '30', '31'] as $id) {
            $this->assertFalse($lines[$id]['included_by_default']);
        }
        $this->assertTrue($lines['22']['included_by_default']);
        $this->assertTrue($lines['23']['included_by_default']);
        $this->assertTrue($lines['40']['normal_until_66_by_default']);
    }

    public function test_failed_source_is_not_cached_or_reported_as_empty_catalog(): void
    {
        $this->login();
        Http::fake(['core.test/*' => Http::sequence()->push(['error' => 'failed'], 500)->push($this->lines())]);
        $this->getJson('/api/bcra/catalog')->assertStatus(503)->assertJsonMissingPath('lines');
        $this->getJson('/api/bcra/catalog')->assertOk()->assertJsonCount(14, 'lines');
    }

    public function test_generation_uses_server_credentials_and_passes_only_validated_parameters(): void
    {
        $this->login();
        $sent = null;
        Http::fake([
            'core.test/*' => Http::response($this->lines()),
            'kestra.test/*' => function ($request) use (&$sent) {
                $sent = $request;

                return Http::response(['id' => 'execution-test-123456']);
            },
        ]);
        $inputs = $this->inputs() + ['api_url' => 'https://attacker.test', 'cmd' => 'injected'];
        $result = $this->postJson('/api/bcra/runs', $inputs)->assertStatus(202);
        $this->assertTrue(Str::isUuid($result->json('run_id')));
        $part = collect($sent->data())->firstWhere('name', 'request');
        $data = json_decode($part['contents'], true);
        $this->assertSame('2026-07', $data['period']);
        $this->assertSame(['10'], $data['selected_line_ids']);
        $this->assertArrayNotHasKey('api_url', $data);
        $this->assertArrayNotHasKey('cmd', $data);
        $this->assertSame($result->json('run_id'), $data['run_id']);
        $this->assertStringContainsString('/api/v1/main/executions/redunisol.dev.contabilidad/bcra_deudores_generate', $sent->url());
    }

    public function test_unknown_lines_future_month_and_exclusions_without_reason_are_rejected(): void
    {
        $this->login();
        Http::fake(['core.test/*' => Http::response($this->lines())]);
        $this->postJson('/api/bcra/runs', array_replace($this->inputs(), ['selected_line_ids' => ['999']]))->assertUnprocessable();
        $this->postJson('/api/bcra/runs', array_replace($this->inputs(), ['period' => now()->format('Y-m')]))->assertUnprocessable();
        $this->postJson('/api/bcra/runs', array_replace($this->inputs(), ['excluded_cuits' => [['value' => '20123456786', 'reason' => '']]]))->assertUnprocessable();
        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'kestra.test'));
    }

    public function test_start_failure_is_not_retried_and_does_not_leak_upstream_response(): void
    {
        $this->login();
        Http::fake(['core.test/*' => Http::response($this->lines()), 'kestra.test/*' => Http::response(['secret' => 'test-secret'], 503)]);
        $this->postJson('/api/bcra/runs', $this->inputs())->assertStatus(503)->assertDontSee('test-secret');
        Http::assertSentCount(2);
    }

    private function savedRun(string $status = 'SUCCESS'): array
    {
        $run = (string) Str::uuid();
        File::makeDirectory($this->root.'/'.$run.'/output', 0755, true);
        File::put($this->root.'/'.$run.'/output/informacion.zip', 'test artifact');
        $metadata = ['run_id' => $run, 'period' => '2026-07', 'declared_by' => 'Pato', 'status' => $status,
            'started_at' => '2026-10-15T13:00:00Z', 'artifacts' => [
                'zip' => ['sha256' => hash('sha256', 'test artifact')],
            ]];
        File::put($this->root.'/'.$run.'/metadata.json', json_encode($metadata));

        return [$run, $metadata];
    }

    public function test_status_is_scoped_to_our_flow_and_valid_file_survives_later_execution_failure(): void
    {
        $this->login();
        [$run] = $this->savedRun();
        Http::fake(['kestra.test/*' => Http::sequence()
            ->push(['namespace' => 'other', 'flowId' => 'other', 'inputs' => ['request' => ['run_id' => $run]]])
            ->push(['namespace' => config('bcra.namespace'), 'flowId' => config('bcra.flow_id'),
                'inputs' => ['request' => json_encode(['run_id' => $run])], 'state' => ['current' => 'FAILED']])]);
        $this->getJson('/api/bcra/executions/execution-test-123456')->assertNotFound();
        $this->getJson('/api/bcra/executions/execution-test-123456')->assertOk()
            ->assertJsonPath('status', 'SUCCESS')->assertJsonPath('execution_state', 'FAILED')
            ->assertJsonPath('run_id', $run)->assertJsonStructure(['downloads' => ['zip']]);
    }

    public function test_download_checks_integrity_and_failed_run_never_serves_zip(): void
    {
        $this->login();
        [$run] = $this->savedRun();
        $this->get('/api/bcra/runs/'.$run.'/download/zip')->assertOk();
        File::put($this->root.'/'.$run.'/output/informacion.zip', 'corrupted');
        $this->get('/api/bcra/runs/'.$run.'/download/zip')->assertStatus(503);
        [$failed] = $this->savedRun('FAILED');
        $this->get('/api/bcra/runs/'.$failed.'/download/zip')->assertNotFound();
        $this->get('/api/bcra/runs/'.$run.'/download/env')->assertNotFound();
        $this->getJson('/api/bcra/runs/not-a-uuid/download/zip')->assertNotFound();
        Http::assertNothingSent();
    }
}
