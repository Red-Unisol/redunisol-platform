<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;
use Tests\TestCase;

class ConsultaBcraTest extends TestCase
{
    private const URL = 'https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/';

    private const CUIT = '20123456786';

    protected function setUp(): void
    {
        parent::setUp();
        Sleep::fake();
        Http::preventStrayRequests();
    }

    private function payload(array $periods): array
    {
        return ['status' => 200, 'results' => ['identificacion' => self::CUIT, 'periodos' => $periods]];
    }

    private function period(string $period, array $entities): array
    {
        return ['periodo' => $period, 'entidades' => array_map(
            fn ($entity) => ['entidad' => $entity[0], 'situacion' => $entity[1], 'monto' => $entity[2]], $entities
        )];
    }

    private function noRecords(): array
    {
        return ['status' => 404, 'errorMessages' => ['No se encontró datos para la identificación ingresada.']];
    }

    public function test_current_debts_and_history_use_the_same_peso_contract_and_include_situation_two(): void
    {
        Http::fake([
            self::URL.self::CUIT => Http::response($this->payload([
                $this->period('202607', [['Santander', 5, 878], ['Cordoba', 1, 15602], ['Otra', 2, 0.125]]),
                $this->period('202606', [['Credikot', 5, 478], ['Santander', 4, 900]]),
            ])),
            self::URL.'Historicas/'.self::CUIT => Http::response($this->payload([
                $this->period('202606', [['Santander', 4, 900], ['Credikot', 5, 478]]),
                $this->period('202604', [['Historica', 2, 50]]),
            ])),
        ]);
        $result = $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertJsonPath('ok', true)
            ->assertJsonPath('bcra.fuente', 'BCRA')
            ->assertJsonPath('bcra.deuda_vigente_total', '$ 16.958.125')
            ->assertJsonPath('bcra.deuda_situacion_negativa_total', '$ 1.356.125')
            ->assertJsonCount(4, 'bcra.deudas_vigentes')
            ->assertJsonPath('bcra.deudas_vigentes.3.periodo', '06/2026')
            ->assertJsonPath('bcra.deudas_24_meses.meses.0', 'Jul')
            ->assertJsonCount(24, 'bcra.deudas_24_meses.meses')
            ->assertJsonPath('bcra.deudas_24_meses.filas.0.situaciones.0', '5')
            ->assertJsonPath('bcra.deudas_24_meses.filas.0.situaciones.1', '4')
            ->assertJsonPath('bcra.deudas_24_meses.filas.0.situaciones.2', '-')
            ->assertJsonPath('bcra.evolucion_deuda_por_entidad.filas.0.celdas.0.monto', '$ 878.000');
        $this->assertStringContainsString('no-store', $result->headers->get('Cache-Control'));
        Sleep::assertNeverSlept();
        Http::assertSentCount(2);
    }

    public function test_only_failed_endpoint_is_retried_with_twelve_second_pauses(): void
    {
        Http::fake([
            self::URL.self::CUIT => Http::response($this->payload([$this->period('202607', [['Banco', 2, 7.125]])])),
            self::URL.'Historicas/'.self::CUIT => Http::sequence()
                ->push([], 503)->push([], 429)
                ->push($this->payload([$this->period('202607', [['Banco', 2, 7.125]])])),
        ]);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertJsonPath('bcra.deuda_situacion_negativa_total', '$ 7.125');
        Http::assertSentCount(4);
        Sleep::assertSequence([Sleep::for(12)->seconds(), Sleep::for(12)->seconds()]);
    }

    public function test_outage_exhausts_three_attempts_and_returns_no_partial_report(): void
    {
        Http::fake(['*' => Http::response([], 503)]);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertExactJson(['ok' => false, 'bcra' => null]);
        Http::assertSentCount(6);
        Sleep::assertSequence([Sleep::for(12)->seconds(), Sleep::for(12)->seconds()]);
    }

    public function test_transport_errors_and_invalid_json_do_not_break_the_fallback(): void
    {
        Http::fake([
            self::URL.self::CUIT => Http::failedConnection(),
            self::URL.'Historicas/'.self::CUIT => Http::response('<html>Unavailable</html>', 200),
        ]);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertExactJson(['ok' => false, 'bcra' => null]);
        Sleep::assertSequence([Sleep::for(12)->seconds(), Sleep::for(12)->seconds()]);
    }

    public function test_documented_no_records_is_not_an_outage_and_clears_old_current_debts(): void
    {
        Http::fake([
            self::URL.self::CUIT => Http::response($this->noRecords(), 404),
            self::URL.'Historicas/'.self::CUIT => Http::response($this->payload([
                $this->period('202605', [['Banco historico', 5, 900]]),
            ])),
        ]);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertJsonPath('ok', true)
            ->assertJsonPath('bcra.deuda_vigente_total', '$ 0')
            ->assertJsonPath('bcra.deuda_situacion_negativa_total', '$ 0')
            ->assertJsonCount(0, 'bcra.deudas_vigentes')
            ->assertJsonPath('bcra.deudas_24_meses.filas.0.activa', false);
        Http::assertSentCount(2);
        Sleep::assertNeverSlept();
    }

    public function test_generic_404_and_incomplete_records_are_not_treated_as_zero_debt(): void
    {
        Http::fake([
            self::URL.self::CUIT => Http::response($this->payload([
                $this->period('202607', [['Banco', 2, null]]),
            ])),
            self::URL.'Historicas/'.self::CUIT => Http::response([], 404),
        ]);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertJsonPath('ok', false)->assertJsonPath('bcra', null);
        Http::assertSentCount(6);
    }

    public function test_wrong_identity_falls_back_even_when_other_endpoint_succeeds(): void
    {
        $wrong = $this->payload([]);
        $wrong['results']['identificacion'] = '27999999999';
        Http::fake([
            self::URL.self::CUIT => Http::response($wrong),
            self::URL.'Historicas/'.self::CUIT => Http::response($this->payload([])),
        ]);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])
            ->assertOk()->assertJsonPath('ok', false);
        Http::assertSentCount(4);
    }

    public function test_invalid_input_or_disabled_site_does_not_call_bcra(): void
    {
        Http::fake();
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => '12345678'])->assertUnprocessable();
        config()->set('tools.enabled', false);
        $this->postJson('/api/tools/consulta-bcra', ['cuit' => self::CUIT])->assertStatus(503);
        Http::assertNothingSent();
    }
}
