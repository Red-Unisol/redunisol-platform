<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConsultaQuiebraCredixTest extends TestCase
{
    public function test_it_requires_at_least_one_search_criterion(): void
    {
        $response = $this->postJson('/api/tools/consulta-quiebra-credix', [
            'cuit' => '',
            'nombre' => '',
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['cuit']);
    }

    public function test_it_accepts_dni_in_the_cuit_field(): void
    {
        config()->set('tools.proxy.consulta_quiebra_credix_url', 'https://kestra.example.test/webhook');
        config()->set('tools.proxy.timeout_seconds', 30);

        Http::fake([
            'https://kestra.example.test/webhook' => Http::response([
                'ok' => true,
                'status' => 'none',
                'cuit' => '12345678',
                'nombre' => '',
                'rows_json' => '[]',
                'data_json' => '[]',
                'response_json' => '{"status":"none","rows":[]}',
                'error' => '',
            ], 200),
        ]);

        $this->postJson('/api/tools/consulta-quiebra-credix', [
            'cuit' => '12345678',
            'nombre' => '',
        ])->assertOk();

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://kestra.example.test/webhook'
                && $request['cuit'] === '12345678';
        });
    }

    public function test_it_proxies_the_request_to_kestra_with_filtered_payload(): void
    {
        config()->set('tools.proxy.consulta_quiebra_credix_url', 'https://kestra.example.test/webhook');
        config()->set('tools.proxy.timeout_seconds', 30);

        Http::fake([
            'https://kestra.example.test/webhook' => Http::response([
                'ok' => true,
                'status' => 'multiple',
                'cuit' => '20123456783',
                'nombre' => 'Juan Perez',
                'rows_json' => '[{"cuit":"20123456783","nombre":"Juan Perez","documento":"12345678"}]',
                'data_json' => '[]',
                'response_json' => '{"status":"multiple","rows":[{"cuit":"20123456783","nombre":"Juan Perez","documento":"12345678"}]}',
                'error' => '',
            ], 200),
        ]);

        $response = $this->postJson('/api/tools/consulta-quiebra-credix', [
            'cuit' => '20-12345678-3',
            'nombre' => 'Juan Perez',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('status', 'multiple')
            ->assertJsonPath('cuit', '20123456783');

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://kestra.example.test/webhook'
                && $request['cuit'] === '20-12345678-3'
                && $request['nombre'] === 'Juan Perez';
        });
    }

    public function test_it_omits_blank_fields_before_proxying(): void
    {
        config()->set('tools.proxy.consulta_quiebra_credix_url', 'https://kestra.example.test/webhook');

        Http::fake([
            'https://kestra.example.test/webhook' => Http::response([
                'ok' => true,
                'status' => 'none',
                'cuit' => '',
                'nombre' => 'Juan Perez',
                'rows_json' => '[]',
                'data_json' => '[]',
                'response_json' => '{"status":"none","rows":[]}',
                'error' => '',
            ], 200),
        ]);

        $this->postJson('/api/tools/consulta-quiebra-credix', [
            'cuit' => '',
            'nombre' => 'Juan Perez',
        ])->assertOk();

        Http::assertSent(function ($request): bool {
            $data = $request->data();

            return $request->url() === 'https://kestra.example.test/webhook'
                && ! array_key_exists('cuit', $data)
                && ($data['nombre'] ?? null) === 'Juan Perez';
        });
    }
}
