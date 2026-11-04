<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class CuadMasivoTest extends TestCase
{
    private string $root;

    private const NS = 'redunisol.prod.analisis-credito';

    private const API = 'https://kestra.test/api/v1/main';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        $this->root = sys_get_temp_dir().'/cuad-masivo-test-'.Str::uuid();
        File::makeDirectory($this->root, 0755, true);
        config()->set([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'tools.enabled' => true,
            'analisis.password_hash' => password_hash('clave-analisis', PASSWORD_BCRYPT, ['cost' => 4]),
            'cuad_masivo.password_hash' => password_hash('clave-riesgo', PASSWORD_BCRYPT, ['cost' => 4]),
            'cuad_masivo.kestra_url' => 'https://kestra.test', 'cuad_masivo.kestra_username' => 'test-operator',
            'cuad_masivo.kestra_password' => 'test-secret', 'cuad_masivo.tenant' => 'main',
            'cuad_masivo.namespace' => self::NS, 'cuad_masivo.output_root' => $this->root,
        ]);
        Cache::flush();
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        // Solo la carpeta propia del test, nunca una raiz real de reportes.
        $resolved = realpath($this->root);
        if ($resolved !== false && dirname($resolved) === realpath(sys_get_temp_dir())
            && str_starts_with(basename($resolved), 'cuad-masivo-test-')) {
            File::deleteDirectory($this->root);
        }
        parent::tearDown();
    }

    private function login(): void
    {
        $this->postJson('/cuad-masivo/login', ['password' => 'clave-riesgo'])->assertOk();
    }

    private function corrida(string $id, array $metadata, bool $conResultado = true): void
    {
        File::makeDirectory("{$this->root}/{$id}", 0755, true);
        File::put("{$this->root}/{$id}/metadata.json", json_encode(['corrida_id' => $id] + $metadata));
        File::put("{$this->root}/{$id}/entrada.json", json_encode(['20123456786']));
        if ($conResultado) {
            File::put("{$this->root}/{$id}/resultado.ndjson", "{\"cuil\":\"20123456786\",\"estado\":\"ok\"}\n");
        }
    }

    private function execution(string $id, string $state, array $inputs = []): array
    {
        return ['id' => $id, 'namespace' => self::NS, 'flowId' => 'consulta_cuad_masivo',
            'state' => ['current' => $state], 'inputs' => $inputs];
    }

    private function fakeKestra(array $activas = [], array $extra = []): void
    {
        Http::fake($extra + [
            self::API.'/executions/search*' => Http::response(['results' => $activas, 'total' => count($activas)]),
            self::API.'/executions/'.self::NS.'/consulta_cuad_masivo' => Http::response(['id' => 'NuevaCorrida0001']),
        ]);
    }

    public function test_tiene_su_propia_contrasena_y_no_expone_secretos(): void
    {
        $this->get('/cuad-masivo')->assertOk()->assertSee('"authenticated":false', false)
            ->assertDontSee('test-secret')->assertDontSee('https://kestra.test');
        $this->getJson('/api/cuad-masivo/corridas')->assertUnauthorized();
        $this->getJson('/api/cuad-masivo/corridas/AbcdefGhij12/descargar')->assertUnauthorized();

        // La contraseña de Análisis no abre esta herramienta.
        $this->postJson('/analisis/login', ['password' => 'clave-analisis']);
        $this->getJson('/api/cuad-masivo/corridas')->assertUnauthorized();
        $this->postJson('/cuad-masivo/login', ['password' => 'clave-analisis'])->assertStatus(422);

        $this->login();
        $this->get('/cuad-masivo')->assertSee('"authenticated":true', false)->assertSee('2703');
    }

    public function test_lanza_una_corrida_con_el_excel(): void
    {
        $this->fakeKestra();
        $this->login();
        $excel = UploadedFile::fake()->createWithContent('lista socios.xlsx', "PK\x03\x04 contenido de prueba");

        $this->post('/api/cuad-masivo/corridas', ['modo' => 'excel', 'lanzado_por' => ' Pato ', 'archivo' => $excel],
            ['Accept' => 'application/json'])
            ->assertStatus(202)->assertJson(['corrida_id' => 'NuevaCorrida0001', 'execution_id' => 'NuevaCorrida0001']);

        Http::assertSent(function (Request $request) {
            if ($request->method() !== 'POST') {
                return false;
            }
            $partes = collect($request->data())->keyBy('name');

            return $request->url() === self::API.'/executions/'.self::NS.'/consulta_cuad_masivo'
                && $partes['archivo']['filename'] === 'lista socios.xlsx'
                && $partes['lanzado_por']['contents'] === 'Pato'
                && $partes['origen']['contents'] === 'Excel lista socios.xlsx'
                && ! $partes->has('lineas');
        });
    }

    public function test_la_linea_es_siempre_la_2703_y_el_excel_se_valida(): void
    {
        // Varios POST seguidos: el limite de 3 lanzamientos por minuto se prueba aparte.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
        $this->fakeKestra();
        $this->login();
        $this->postJson('/api/cuad-masivo/corridas', ['modo' => 'linea', 'lanzado_por' => 'Pato'])->assertStatus(202);
        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && collect($r->data())->firstWhere('name', 'lineas')['contents'] === '2703');

        $csv = UploadedFile::fake()->createWithContent('lista.csv', "CUIL\n20123456786\n");
        $this->post('/api/cuad-masivo/corridas', ['modo' => 'excel', 'lanzado_por' => 'Pato', 'archivo' => $csv],
            ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors('archivo');
        $this->postJson('/api/cuad-masivo/corridas', ['modo' => 'excel', 'lanzado_por' => 'Pato'])
            ->assertStatus(422)->assertJsonValidationErrors('archivo');
        $this->postJson('/api/cuad-masivo/corridas', ['modo' => 'linea'])->assertStatus(422)->assertJsonValidationErrors('lanzado_por');
    }

    public function test_limita_los_lanzamientos_por_minuto(): void
    {
        $this->fakeKestra([$this->execution('CorridaActiva01', 'RUNNING')]);
        $this->login();
        foreach (range(1, 3) as $_) {
            $this->postJson('/api/cuad-masivo/corridas', ['modo' => 'linea', 'lanzado_por' => 'Pato'])->assertStatus(422);
        }
        $this->postJson('/api/cuad-masivo/corridas', ['modo' => 'linea', 'lanzado_por' => 'Pato'])->assertStatus(429);
    }

    public function test_no_lanza_si_hay_una_corrida_activa(): void
    {
        $this->fakeKestra([$this->execution('CorridaActiva01', 'RUNNING')]);
        $this->login();
        $this->postJson('/api/cuad-masivo/corridas', ['modo' => 'linea', 'lanzado_por' => 'Pato'])
            ->assertStatus(422)->assertJsonValidationErrors('corrida');
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    public function test_estado_en_curso_con_cuentas_y_cuenta_frenada(): void
    {
        $id = 'CorridaEnCurso1';
        $this->corrida($id, ['estado' => 'corriendo', 'total' => 10, 'ok' => 2, 'creada_en' => now()->toIso8601String(),
            'ejecuciones' => [['execution_id' => $id, 'estado' => 'corriendo']]]);
        $kv = ['corrida_id' => $id, 'execution_id' => $id, 'estado' => 'corriendo', 'hechos' => 4, 'total' => 10, 'cuentas' => [
            'A' => ['estado' => 'pausa', 'consultados' => 2, 'desde' => now()->toIso8601String(), 'hasta' => now()->addSeconds(15)->toIso8601String()],
            'B' => ['estado' => 'consultando', 'consultados' => 2, 'desde' => now()->subMinutes(10)->toIso8601String()],
        ]];
        $this->fakeKestra([], [
            self::API.'/namespaces/'.self::NS.'/kv/cuad_masivo_estado_'.$id => Http::response(['type' => 'JSON', 'value' => json_encode($kv)]),
            self::API.'/executions/'.$id => Http::response($this->execution($id, 'RUNNING')),
        ]);
        $this->login();

        $respuesta = $this->getJson("/api/cuad-masivo/corridas/{$id}")->assertOk()
            ->assertJson(['estado' => 'corriendo', 'activa' => true, 'progreso' => ['hechos' => 4, 'total' => 10]]);
        $cuentas = collect($respuesta->json('cuentas'))->keyBy('alias');
        $this->assertFalse($cuentas['A']['frenada']);
        $this->assertTrue($cuentas['B']['frenada']);
        $this->assertFalse($cuentas['B']['reintentable']);
    }

    public function test_corte_duro_se_muestra_interrumpida_y_se_puede_retomar(): void
    {
        $id = 'CorridaCortada1';
        $this->corrida($id, ['estado' => 'corriendo', 'total' => 10, 'ok' => 3, 'pendientes' => 7,
            'ejecuciones' => [['execution_id' => $id, 'estado' => 'corriendo']]]);
        $this->fakeKestra([], [
            self::API.'/namespaces/'.self::NS.'/kv/*' => Http::response([], 404),
            self::API.'/executions/'.$id => Http::response($this->execution($id, 'KILLED')),
        ]);
        $this->login();

        $this->getJson("/api/cuad-masivo/corridas/{$id}")->assertOk()->assertJson(['estado' => 'interrumpida', 'activa' => false]);
        $this->getJson('/api/cuad-masivo/corridas')->assertOk()
            ->assertJsonPath('corridas.0.estado', 'interrumpida')->assertJsonPath('corridas.0.retomable', true);

        $this->postJson("/api/cuad-masivo/corridas/{$id}/retomar", ['lanzado_por' => 'Pato'])
            ->assertStatus(202)->assertJson(['corrida_id' => $id, 'execution_id' => 'NuevaCorrida0001']);
        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && collect($r->data())->firstWhere('name', 'corrida_id')['contents'] === $id);
    }

    public function test_no_retoma_una_corrida_terminada(): void
    {
        $id = 'CorridaTerminad';
        $this->corrida($id, ['estado' => 'terminada', 'ejecuciones' => [['execution_id' => $id]]]);
        $this->fakeKestra();
        $this->login();
        $this->postJson("/api/cuad-masivo/corridas/{$id}/retomar", ['lanzado_por' => 'Pato'])->assertStatus(422);
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    public function test_reintentar_escribe_el_kv_solo_para_una_cuenta_caida(): void
    {
        $id = 'CorridaCaida001';
        $this->corrida($id, ['estado' => 'corriendo', 'ejecuciones' => [['execution_id' => $id]]]);
        $kv = ['corrida_id' => $id, 'execution_id' => $id, 'cuentas' => [
            'A' => ['estado' => 'caida', 'desde' => now()->toIso8601String()],
            'B' => ['estado' => 'consultando', 'desde' => now()->toIso8601String()],
        ]];
        $this->fakeKestra([], [
            self::API.'/namespaces/'.self::NS.'/kv/cuad_masivo_estado_'.$id => Http::response(['value' => $kv]),
            self::API.'/namespaces/'.self::NS.'/kv/cuad_masivo_reintentar_*' => Http::response([], 200),
            self::API.'/executions/'.$id => Http::response($this->execution($id, 'RUNNING')),
        ]);
        $this->login();

        $this->postJson("/api/cuad-masivo/corridas/{$id}/reintentar/A")->assertStatus(202);
        Http::assertSent(fn (Request $r) => $r->method() === 'PUT'
            && $r->url() === self::API.'/namespaces/'.self::NS."/kv/cuad_masivo_reintentar_{$id}_A");
        $this->postJson("/api/cuad-masivo/corridas/{$id}/reintentar/B")->assertStatus(422);
        $this->postJson("/api/cuad-masivo/corridas/{$id}/reintentar/a1")->assertNotFound();
    }

    public function test_descarga_el_ndjson_y_rechaza_ids_invalidos(): void
    {
        $id = 'CorridaLista001';
        $this->corrida($id, ['estado' => 'terminada', 'creada_en' => '2026-11-04T14:47:12-03:00', 'ejecuciones' => []]);
        $this->fakeKestra();
        $this->login();

        $respuesta = $this->get("/api/cuad-masivo/corridas/{$id}/descargar")->assertOk();
        $this->assertStringContainsString("cuad-masivo-2026-11-04-{$id}.ndjson", $respuesta->headers->get('content-disposition'));
        $this->assertStringContainsString('20123456786', $respuesta->streamedContent());

        $this->get('/api/cuad-masivo/corridas/..%2F..%2Fetc/descargar')->assertNotFound();
        $this->get('/api/cuad-masivo/corridas/corto/descargar')->assertNotFound();
        $this->getJson('/api/cuad-masivo/corridas')->assertOk()->assertJsonPath('corridas.0.metadata.descarga', route('cuad-masivo.download', ['corrida' => $id]));
    }
}
