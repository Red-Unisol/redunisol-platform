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

test('Santa Fe and Mutual PAII have separate pools and Renato is available', function () {
    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('santa_fe', [10451, 29, 116561])
        ->assertJsonPath('mutual_paii', [10451, 29, 116561])
        ->assertJsonPath('neuquen', [58913]);

    expect(BitrixRoutingConfig::sellerOptions()[58913])->toBe('Ludmila Gallardo');
    expect(BitrixRoutingConfig::sellerOptions()[127337])->toBe('Renato Rodriguez Barros');
});

test('the new pools preserve explicit pauses and do not mix their assignments', function () {
    app(BitrixRoutingConfig::class)->save([
        'santa_fe' => [
            ['user_id' => 29, 'paused' => false],
            ['user_id' => 10451, 'paused' => true],
        ],
        'neuquen' => [
            ['user_id' => 58913, 'paused' => true],
        ],
    ]);

    $this->getJson('/api/internal/bitrix-routing')
        ->assertOk()
        ->assertJsonPath('santa_fe', [29])
        ->assertJsonPath('mutual_paii', [10451, 29, 116561])
        ->assertJsonPath('neuquen', []);
});

test('both split pools inherit the stored order and pauses until independently saved', function () {
    $sellers = [
        ['user_id' => 29, 'paused' => true],
        ['user_id' => 116561, 'paused' => false],
    ];
    BitrixRoutingBucket::query()->create(['key' => 'santa_fe_anses', 'sellers' => $sellers]);
    $config = app(BitrixRoutingConfig::class);
    expect($config->forForm()['santa_fe'])->toBe($sellers);
    expect($config->forForm()['mutual_paii'])->toBe($sellers);

    $config->save(['mutual_paii' => [['user_id' => 127337, 'paused' => false]]]);
    $this->getJson('/api/internal/bitrix-routing')->assertOk()
        ->assertJsonPath('santa_fe', [116561])
        ->assertJsonPath('mutual_paii', [127337])
        ->assertJsonPath('santa_fe_anses', [116561]);

    $config->save(['santa_fe' => []]);
    $this->getJson('/api/internal/bitrix-routing')->assertOk()
        ->assertJsonPath('santa_fe', [])
        ->assertJsonPath('mutual_paii', [127337]);
});

test('a paused legacy group stays paused after the split', function () {
    BitrixRoutingBucket::query()->create(['key' => 'santa_fe_anses', 'sellers' => []]);
    $this->getJson('/api/internal/bitrix-routing')->assertOk()
        ->assertJsonPath('santa_fe', [])
        ->assertJsonPath('mutual_paii', []);
});
