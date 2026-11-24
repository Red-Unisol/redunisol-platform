<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConsultaEmpleadorTest extends TestCase
{
    private string $registroDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->registroDir = sys_get_temp_dir().'/empleador-registro-'.uniqid();
        config()->set('tools.empleador_registro_path', $this->registroDir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->registroDir.'/*') ?: [] as $file) {
            unlink($file);
        }
        @rmdir($this->registroDir);
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_it_requires_an_identifier(): void
    {
        $response = $this->withSession(['empleador_usuario' => 'aortega'])->postJson('/api/tools/consulta-empleador', [
            'identificador' => '',
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['identificador']);
    }

    public function test_it_proxies_cuil_queries_to_kestra(): void
    {
        config()->set('tools.proxy.consulta_empleador_url', 'https://kestra.example.test/webhook');
        config()->set('tools.proxy.timeout_seconds', 30);

        Http::fake([
            'https://kestra.example.test/webhook' => Http::response([
                'ok' => true,
                'found' => true,
                'identifier' => '20359661305',
                'tipo' => 'S',
                'data_json' => '{"RESULTADO":{"persona":{"row":{"cuil":20359661305}}}}',
                'response_json' => '{"ok":true}',
                'error' => '',
            ], 200),
        ]);

        $this->withSession(['empleador_usuario' => 'aortega'])->postJson('/api/tools/consulta-empleador', [
            'identificador' => '20-35966130-5',
        ])->assertOk();

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://kestra.example.test/webhook'
                && $request['cuil'] === '20-35966130-5'
                && ! isset($request['dni']);
        });
    }

    public function test_it_proxies_dni_queries_to_kestra(): void
    {
        config()->set('tools.proxy.consulta_empleador_url', 'https://kestra.example.test/webhook');
        config()->set('tools.proxy.timeout_seconds', 30);

        Http::fake([
            'https://kestra.example.test/webhook' => Http::response([
                'ok' => true,
                'found' => true,
                'identifier' => '35966130',
                'tipo' => 'M',
                'data_json' => '{"RESULTADO":{"persona":{"row":{"documento":35966130}}}}',
                'response_json' => '{"ok":true}',
                'error' => '',
            ], 200),
        ]);

        $this->withSession(['empleador_usuario' => 'aortega'])->postJson('/api/tools/consulta-empleador', [
            'identificador' => '35966130',
        ])->assertOk();

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://kestra.example.test/webhook'
                && $request['dni'] === '35966130'
                && ! isset($request['cuil']);
        });
    }

    public function test_it_requires_a_vimarx_login(): void
    {
        config()->set('tools.proxy.consulta_empleador_url', 'https://kestra.example.test/webhook');
        Http::fake();

        $this->postJson('/api/tools/consulta-empleador', ['identificador' => '35966130'])
            ->assertStatus(401)
            ->assertJsonPath('error', 'login_required');

        Http::assertNothingSent();
    }

    public function test_login_with_valid_vimarx_credentials_keeps_only_the_user(): void
    {
        config()->set('tools.vimarx_login_url', 'https://vimarx.example.test/api/auth/login_user');
        Http::fake(['https://vimarx.example.test/*' => Http::response(['token' => 'a.b.c'], 200)]);

        $this->postJson('/api/tools/consulta-empleador/login', ['usuario' => ' aortega ', 'clave' => 'secreta'])
            ->assertOk()
            ->assertJsonPath('usuario', 'aortega')
            ->assertSessionHas('empleador_usuario', 'aortega');

        Http::assertSent(fn ($request): bool => $request['user_name'] === 'aortega' && $request['user_password'] === 'secreta');
        $this->assertNotContains('secreta', session()->all());
    }

    public function test_login_rejects_wrong_credentials(): void
    {
        config()->set('tools.vimarx_login_url', 'https://vimarx.example.test/api/auth/login_user');
        Http::fake(['https://vimarx.example.test/*' => Http::response(['error' => 'Usuario o clave incorrectos'], 200)]);

        $this->postJson('/api/tools/consulta-empleador/login', ['usuario' => 'aortega', 'clave' => 'mala'])
            ->assertStatus(422)
            ->assertSessionMissing('empleador_usuario');
    }

    public function test_login_reports_when_vimarx_is_down(): void
    {
        config()->set('tools.vimarx_login_url', 'https://vimarx.example.test/api/auth/login_user');
        Http::fake(['https://vimarx.example.test/*' => Http::response('', 500)]);

        $this->postJson('/api/tools/consulta-empleador/login', ['usuario' => 'aortega', 'clave' => 'x'])
            ->assertStatus(503)
            ->assertSessionMissing('empleador_usuario');
    }

    public function test_logout_forgets_the_user(): void
    {
        $this->withSession(['empleador_usuario' => 'aortega'])
            ->postJson('/api/tools/consulta-empleador/logout')
            ->assertOk()
            ->assertSessionMissing('empleador_usuario');
    }

    public function test_each_query_is_logged_with_user_identifier_and_status(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-24 13:05:00', 'UTC'));
        config()->set('tools.proxy.consulta_empleador_url', 'https://kestra.example.test/webhook');
        Http::fakeSequence('https://kestra.example.test/webhook')
            ->push(['ok' => true, 'found' => true, 'data_json' => '{"secreto":"no se guarda"}'], 200)
            ->push(['ok' => false, 'error' => 'falla'], 500);

        $this->withSession(['empleador_usuario' => 'aortega'])
            ->postJson('/api/tools/consulta-empleador', ['identificador' => '20-35966130-5'])->assertOk();
        $this->withSession(['empleador_usuario' => 'jperez'])
            ->postJson('/api/tools/consulta-empleador', ['identificador' => '35966130'])->assertStatus(502);

        $contenido = file_get_contents($this->registroDir.'/consultas-2026-11.ndjson');
        $this->assertStringNotContainsString('secreto', $contenido);

        $this->withSession(['empleador_usuario' => 'aortega'])
            ->getJson('/api/tools/consulta-empleador/registro?mes=2026-11')
            ->assertOk()
            ->assertJsonPath('meses', ['2026-11'])
            ->assertJsonCount(2, 'consultas')
            ->assertJsonPath('consultas.0.usuario', 'jperez')
            ->assertJsonPath('consultas.0.identificador', '35966130')
            ->assertJsonPath('consultas.0.estado', 'error')
            ->assertJsonPath('consultas.1.usuario', 'aortega')
            ->assertJsonPath('consultas.1.identificador', '20359661305')
            ->assertJsonPath('consultas.1.estado', 'ok')
            ->assertJsonPath('consultas.1.fecha', '2026-11-24T10:05:00-03:00');
    }

    public function test_invalid_identifier_is_not_logged(): void
    {
        $this->withSession(['empleador_usuario' => 'aortega'])
            ->postJson('/api/tools/consulta-empleador', ['identificador' => 'abc'])->assertStatus(422);

        $this->assertSame([], glob($this->registroDir.'/*') ?: []);
    }

    public function test_registro_requires_login(): void
    {
        $this->getJson('/api/tools/consulta-empleador/registro')->assertStatus(401);
        $this->get('/api/tools/consulta-empleador/registro.csv')->assertStatus(401);
    }

    public function test_registro_downloads_as_csv(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-24 13:05:00', 'UTC'));
        config()->set('tools.proxy.consulta_empleador_url', 'https://kestra.example.test/webhook');
        Http::fake(['https://kestra.example.test/webhook' => Http::response(['ok' => true, 'found' => false], 200)]);

        $this->withSession(['empleador_usuario' => 'aortega'])
            ->postJson('/api/tools/consulta-empleador', ['identificador' => '35966130'])->assertOk();

        $response = $this->withSession(['empleador_usuario' => 'aortega'])
            ->get('/api/tools/consulta-empleador/registro.csv?mes=2026-11');

        $response->assertOk();
        $this->assertStringContainsString('consultas-empleador-2026-11.csv', $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString('24/11/2026 10:05:00;aortega;35966130;ok', $response->getContent());
    }
}
