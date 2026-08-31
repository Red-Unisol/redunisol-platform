<?php

namespace Tests\Feature;

use Tests\TestCase;

class BcraCentralDeudoresCatalogTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }

    public function test_bcra_central_deudores_appears_in_tools_catalog(): void
    {
        config()->set('tools.bcra.panel_url', 'http://bcra-panel.example.test');

        $response = $this->get('/');

        $response
            ->assertStatus(200)
            ->assertSee('BCRA Central de Deudores PNFC')
            ->assertSee('Abrir panel')
            ->assertSee('http://bcra-panel.example.test', false);
    }
}
