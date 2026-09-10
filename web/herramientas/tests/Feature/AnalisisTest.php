<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AnalisisTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        config()->set([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'tools.enabled' => true,
            'analisis.password_hash' => password_hash('test-only-password', PASSWORD_BCRYPT, ['cost' => 4]),
            'analisis.core_url' => 'https://core.test',
            'analisis.cache_store' => 'array',
        ]);
        Cache::flush();
        Http::preventStrayRequests();
    }

    private function login(): void
    {
        $this->postJson('/analisis/login', ['password' => 'test-only-password'])->assertOk();
    }

    private function row(int $id, int $state = 114, string $analyst = 'dmontaña', int $assignment = 20, int $exit = 10): array
    {
        return [$id, '2025-01-01', $state, 'Internal state', 12345678, 20123456786, 'Socio de prueba', $analyst, $assignment, $exit];
    }

    public function test_password_protects_both_data_endpoints_and_is_not_in_the_page(): void
    {
        $this->get('/analisis')->assertOk()->assertSee('"authenticated":false', false)
            ->assertDontSee(config('analisis.password_hash'), false)->assertDontSee('https://core.test', false);
        $this->getJson('/api/analisis/analysts')->assertUnauthorized();
        $this->getJson('/api/analisis/snapshot?analyst=dmontaña')->assertUnauthorized();
        Http::assertNothingSent();
        $this->postJson('/analisis/login', ['password' => 'wrong'])->assertStatus(422);
        $this->login();
        $this->get('/analisis')->assertSee('"authenticated":true', false)->assertHeader('Cache-Control', 'no-store, private');
        $this->postJson('/analisis/logout')->assertOk();
        $this->getJson('/api/analisis/analysts')->assertUnauthorized();
    }

    public function test_password_rotation_revokes_existing_sessions(): void
    {
        $this->login();
        config()->set('analisis.password_hash', password_hash('rotated', PASSWORD_BCRYPT));
        $this->getJson('/api/analisis/analysts')->assertUnauthorized();
    }

    public function test_access_fails_closed_without_configuration_or_when_site_disabled(): void
    {
        config()->set('analisis.password_hash', '');
        $this->get('/analisis')->assertSee('"configured":false', false);
        $this->postJson('/analisis/login', ['password' => 'anything'])->assertStatus(503);
        config()->set('tools.enabled', false);
        $this->get('/analisis')->assertStatus(503);
        $this->getJson('/api/analisis/snapshot?analyst=test')->assertStatus(503);
    }

    public function test_login_attempts_are_limited(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/analisis/login', ['password' => 'wrong'])->assertStatus(422);
        }
        $this->postJson('/analisis/login', ['password' => 'wrong'])->assertStatus(429)->assertHeader('Retry-After');
    }

    public function test_analysts_use_actual_usernames_and_cache_the_source(): void
    {
        $this->login();
        Http::fake(['core.test/*' => Http::response([
            ['Otro usuario', 'vendedor'], ['Marín', 'jmarin'], ['Darío', 'dmontaña'],
            ['Grupo sin usuario', null], ['Duplicado', 'dmontaña'], ['Salguero', 'ssalguero'], ['Ortega', 'aortega'],
        ])]);
        $response = $this->getJson('/api/analisis/analysts')->assertOk()->assertJsonCount(4, 'analysts');
        $this->assertSame(['dmontaña', 'aortega', 'jmarin', 'ssalguero'], array_column($response->json('analysts'), 'username'));
        $this->getJson('/api/analisis/analysts')->assertOk();
        Http::assertSentCount(1);
    }

    public function test_inbox_excludes_vendor_and_closed_states_and_filters_analyst_without_date_cutoff(): void
    {
        $this->login();
        $rows = [];
        foreach (array_keys(config('analisis.excluded_states')) as $state) {
            $rows[] = $this->row(1000 + $state, $state);
        }
        foreach ([114, 117, 121, 123, 999] as $state) {
            $rows[] = $this->row($state, $state);
        }
        $rows[] = $this->row(2000, 114, 'aortega');
        Http::fake(['core.test/*' => Http::response($rows)]);
        $this->getJson('/api/analisis/snapshot?'.http_build_query(['analyst' => 'DMONTAÑA']))
            ->assertOk()->assertJsonCount(5, 'items')->assertJsonPath('items.0.id', '999')
            ->assertJsonPath('items.0.assignment', '20:10')->assertJsonPath('items.0.date', '2025-01-01');
        $this->getJson('/api/analisis/snapshot?analyst=aortega')->assertJsonCount(1, 'items');
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => ! str_contains($request['cmd'], 'Fecha')
            && str_contains($request['cmd'], '122') && str_contains($request['campos'], 'Cambio Ejecutivo')
            && str_contains($request['campos'], 'Verificacion de Documentos y Firma'));
    }

    public function test_untrusted_username_never_reaches_core(): void
    {
        $this->login();
        $this->getJson('/api/analisis/snapshot?'.http_build_query(['analyst' => "' OR True"]))->assertStatus(422);
        $this->getJson('/api/analisis/snapshot?analyst=vendedor')->assertStatus(422)->assertJsonValidationErrors(['analyst']);
        $this->getJson('/api/analisis/snapshot?analyst[]=dmonta')->assertStatus(422);
        Http::assertNothingSent();
    }

    public function test_core_json_string_wrapper_is_supported(): void
    {
        $this->login();
        Http::fake(['core.test/*' => Http::response(json_encode(json_encode([$this->row(1)])), 200, ['Content-Type' => 'application/json'])]);
        $this->getJson('/api/analisis/snapshot?'.http_build_query(['analyst' => 'dmontaña']))
            ->assertOk()->assertJsonCount(1, 'items');
    }

    public function test_changes_in_assignment_and_return_from_excluded_states_change_the_signature(): void
    {
        $this->login();
        Http::fakeSequence()->push([$this->row(1)])->push([$this->row(1, 114, 'dmontaña', 30, 10)])
            ->push([$this->row(1, 117, 'dmontaña', 30, 40)]);
        $url = '/api/analisis/snapshot?'.http_build_query(['analyst' => 'dmontaña']);
        $this->getJson($url)->assertJsonPath('items.0.assignment', '20:10');
        $this->travel(16)->seconds();
        $this->getJson($url)->assertJsonPath('items.0.assignment', '30:10');
        $this->travel(16)->seconds();
        $this->getJson($url)->assertJsonPath('items.0.assignment', '30:40');
    }

    public function test_source_failures_or_truncation_are_not_published_as_empty_inboxes(): void
    {
        $this->login();
        config()->set('analisis.max_rows', 1);
        Http::fakeSequence()->push(['error' => 'internal-secret'], 500)
            ->push([$this->row(1), $this->row(2)])
            ->push([[1, 'invalid']])
            ->push([$this->row(1)]);
        $url = '/api/analisis/snapshot?'.http_build_query(['analyst' => 'dmontaña']);
        for ($i = 0; $i < 3; $i++) {
            $this->getJson($url)->assertStatus(503)->assertDontSee('internal-secret');
        }
        $this->getJson($url)->assertOk()->assertJsonCount(1, 'items');
    }
}
