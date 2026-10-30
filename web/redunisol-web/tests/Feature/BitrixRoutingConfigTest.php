<?php

use App\Models\BitrixRoutingBucket;
use App\Models\User;
use App\Support\BitrixRoutingConfig;

test('it exposes the current seller pools when no custom configuration exists', function () {
    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('catamarca_general.0', 68579)
        ->assertJsonPath('policia_federal_caba', [8057])
        ->assertJsonPath('cordoba_unc', [53121]);
});

test('it preserves order and excludes paused sellers from the endpoint', function () {
    app(BitrixRoutingConfig::class)->save([
        'catamarca_general' => [
            ['user_id' => 29, 'paused' => false],
            ['user_id' => 68579, 'paused' => true],
            ['user_id' => 10451, 'paused' => false],
        ],
    ]);

    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('catamarca_general', [29, 10451])
        ->assertJsonPath('cordoba_unc', [53121]);

    expect(BitrixRoutingBucket::find('catamarca_general')->sellers)->toBe([
        ['user_id' => 29, 'paused' => false],
        ['user_id' => 68579, 'paused' => true],
        ['user_id' => 10451, 'paused' => false],
    ]);
});

test('an authenticated user can open the routing settings page', function () {
    $this->actingAs(User::factory()->create(['email' => 'admin@redunisol.local']))
        ->get('/admin/distribucion-bitrix')
        ->assertOk()
        ->assertSee('Catamarca — General')
        ->assertSee('Pausado');
});

test('federal police sellers can be changed and paused without changing other pools', function () {
    app(BitrixRoutingConfig::class)->save([
        'policia_federal_caba' => [
            ['user_id' => 8057, 'paused' => true],
            ['user_id' => 53121, 'paused' => false],
        ],
    ]);

    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('policia_federal_caba', [53121])
        ->assertJsonPath('cordoba_unc', [53121]);
});

test('the shared Santa Fe and ANSES pool and exclusive Neuquen pool have the approved sellers', function () {
    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('santa_fe_anses', [10451, 29, 116561])
        ->assertJsonPath('neuquen', [58913]);

    expect(BitrixRoutingConfig::sellerOptions()[58913])->toBe('Ludmila Gallardo');
});

test('the new pools preserve explicit pauses and do not mix their assignments', function () {
    app(BitrixRoutingConfig::class)->save([
        'santa_fe_anses' => [
            ['user_id' => 29, 'paused' => false],
            ['user_id' => 10451, 'paused' => true],
        ],
        'neuquen' => [
            ['user_id' => 58913, 'paused' => true],
        ],
    ]);

    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('santa_fe_anses', [29])
        ->assertJsonPath('neuquen', []);
});
