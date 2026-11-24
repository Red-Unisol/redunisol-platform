<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConsultaEmpleadorTest extends TestCase
{
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
}
