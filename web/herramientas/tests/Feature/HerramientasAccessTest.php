<?php

namespace Tests\Feature;

use Tests\TestCase;

class HerramientasAccessTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }

    public function test_home_requires_access_when_enabled(): void
    {
        config()->set('tools.access.required', true);
        config()->set('tools.access.password_hash', 'sha256:'.hash('sha256', 'panel-seguro'));

        $response = $this->get('/');

        $response->assertRedirect(route('tools.access.show'));
    }

    public function test_api_requires_access_when_enabled(): void
    {
        config()->set('tools.access.required', true);
        config()->set('tools.access.password_hash', 'sha256:'.hash('sha256', 'panel-seguro'));

        $response = $this->postJson('/api/tools/consulta-cuad', [
            'cuil' => '20123456789',
        ]);

        $response
            ->assertStatus(401)
            ->assertJsonPath('error', 'tools_access_required');
    }

    public function test_login_with_correct_password_grants_access(): void
    {
        config()->set('tools.access.required', true);
        config()->set('tools.access.password_hash', 'sha256:'.hash('sha256', 'panel-seguro'));

        $this->post('/acceso', [
            'password' => 'panel-seguro',
        ])->assertRedirect(route('home'));

        $this->get('/')
            ->assertStatus(200)
            ->assertSee('Herramientas Red Unisol');
    }

    public function test_login_with_wrong_password_is_rejected(): void
    {
        config()->set('tools.access.required', true);
        config()->set('tools.access.password_hash', 'sha256:'.hash('sha256', 'panel-seguro'));

        $this->post('/acceso', [
            'password' => 'incorrecta',
        ])->assertSessionHasErrors('password');

        $this->get('/')->assertRedirect(route('tools.access.show'));
    }

    public function test_missing_password_hash_blocks_access(): void
    {
        config()->set('tools.access.required', true);
        config()->set('tools.access.password_hash', '');

        $this->get('/')
            ->assertStatus(503)
            ->assertSee('HERRAMIENTAS_ACCESS_PASSWORD_HASH');

        $this->postJson('/api/tools/consulta-cuad', [
            'cuil' => '20123456789',
        ])
            ->assertStatus(503)
            ->assertJsonPath('error', 'tools_access_not_configured');
    }
}
