<?php

namespace Tests\Feature;

use Tests\TestCase;

class ObjectivesDashboardTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }

    public function test_it_renders_the_objectives_dashboard_screen(): void
    {
        $response = $this->get('/objetivos/oficina');

        $response
            ->assertOk()
            ->assertSee('objectives-dashboard')
            ->assertSee('/api/objetivos/oficina/snapshot');
    }

    public function test_it_returns_the_configured_snapshot(): void
    {
        $snapshotPath = storage_path('framework/testing/objectives/latest.json');
        if (! is_dir(dirname($snapshotPath))) {
            mkdir(dirname($snapshotPath), 0777, true);
        }

        file_put_contents($snapshotPath, json_encode([
            'periodo_actual' => '2026-05',
            'actualizado_en' => '2026-05-21T10:30:00-03:00',
            'metricas' => [
                [
                    'id' => 'first_response',
                    'nombre' => 'Tiempo de Primera Respuesta',
                    'actual_min' => 20.4,
                    'objetivo_min' => 21.95,
                    'casos' => 850,
                    'estado' => 'verde',
                ],
            ],
        ]));

        config()->set('tools.objectives.snapshot_path', $snapshotPath);

        $response = $this->getJson('/api/objetivos/oficina/snapshot');

        $response
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store')
            ->assertJsonPath('periodo_actual', '2026-05')
            ->assertJsonPath('metricas.0.id', 'first_response')
            ->assertJsonPath('metricas.0.objetivo_min', 21.95);

        unlink($snapshotPath);
    }

    public function test_it_reports_missing_snapshot(): void
    {
        config()->set('tools.objectives.snapshot_path', storage_path('framework/testing/objectives/missing.json'));

        $response = $this->getJson('/api/objetivos/oficina/snapshot');

        $response
            ->assertStatus(404)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('error', 'snapshot_not_found');
    }
}
