<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConsultaEmpleadorTest extends TestCase
{
    public function test_it_requires_an_identifier(): void
    {
        $response = $this->postJson('/api/tools/consulta-empleador', [
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

        $this->postJson('/api/tools/consulta-empleador', [
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

        $this->postJson('/api/tools/consulta-empleador', [
            'identificador' => '35966130',
        ])->assertOk();

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://kestra.example.test/webhook'
                && $request['dni'] === '35966130'
                && ! isset($request['cuil']);
        });
    }
}
