<?php

use App\Models\BitrixRoutingAllocation;
use App\Models\BitrixRoutingDailyBalance;
use Carbon\CarbonImmutable;

beforeEach(function () {
    config()->set('services.bitrix_routing.allocation_token', 'test-allocation-token');
    config()->set('services.bitrix_routing.compensation_every', 4);
    CarbonImmutable::setTestNow('2026-09-08 10:00:00 America/Argentina/Cordoba');
});

afterEach(function () {
    CarbonImmutable::setTestNow();
});

function allocateDeal(array $payload)
{
    return test()->withToken('test-allocation-token')->postJson(
        '/api/internal/bitrix-routing/allocate',
        [
            'scope' => 'redunisol.prod.marketing-crm',
            'bucket' => 'catamarca_general',
            'online_user_ids' => [68579, 10451],
            'recurring' => false,
            ...$payload,
        ],
    );
}

test('it keeps recurring ownership and counts it toward the daily balance', function () {
    allocateDeal([
        'deal_id' => 1001,
        'proposed_user_id' => 68579,
        'recurring' => true,
    ])->assertOk()
        ->assertJsonPath('assigned_user_id', 68579)
        ->assertJsonPath('recurring', true)
        ->assertJsonPath('compensated', false);

    $balance = BitrixRoutingDailyBalance::query()->firstOrFail();

    expect($balance->expected['68579'])->toBe(0.5)
        ->and($balance->expected['10451'])->toBe(0.5)
        ->and($balance->assigned['68579'])->toBe(1)
        ->and($balance->assigned['10451'])->toBe(0);
});

test('it compensates only every fourth non recurring deal', function () {
    allocateDeal(['deal_id' => 1001, 'proposed_user_id' => 68579, 'recurring' => true]);
    allocateDeal(['deal_id' => 1002, 'proposed_user_id' => 68579])
        ->assertOk()
        ->assertJsonPath('compensation_turn', false)
        ->assertJsonPath('assigned_user_id', 68579);
    allocateDeal(['deal_id' => 1003, 'proposed_user_id' => 10451])
        ->assertOk()
        ->assertJsonPath('compensation_turn', false)
        ->assertJsonPath('assigned_user_id', 10451);
    allocateDeal(['deal_id' => 1004, 'proposed_user_id' => 68579])
        ->assertOk()
        ->assertJsonPath('compensation_turn', false)
        ->assertJsonPath('assigned_user_id', 68579);

    allocateDeal(['deal_id' => 1005, 'proposed_user_id' => 68579])
        ->assertOk()
        ->assertJsonPath('compensation_turn', true)
        ->assertJsonPath('compensated', true)
        ->assertJsonPath('assigned_user_id', 10451);
});

test('it is idempotent for retries of the same deal', function () {
    $payload = ['deal_id' => 1001, 'proposed_user_id' => 68579, 'recurring' => true];

    allocateDeal($payload)->assertOk();
    allocateDeal($payload)->assertOk()->assertJsonPath('assigned_user_id', 68579);

    expect(BitrixRoutingAllocation::query()->count())->toBe(1)
        ->and(BitrixRoutingDailyBalance::query()->firstOrFail()->assigned['68579'])->toBe(1);
});

test('it does not accrue deficit for sellers that were not online', function () {
    allocateDeal([
        'deal_id' => 1001,
        'online_user_ids' => [68579],
        'proposed_user_id' => 68579,
    ])->assertOk();

    $balance = BitrixRoutingDailyBalance::query()->firstOrFail();

    expect($balance->expected)->toHaveKey('68579')
        ->and($balance->expected)->not->toHaveKey('10451');
});

test('it starts a new balance on the next business day', function () {
    allocateDeal(['deal_id' => 1001, 'proposed_user_id' => 68579])->assertOk();

    CarbonImmutable::setTestNow('2026-09-09 10:00:00 America/Argentina/Cordoba');
    allocateDeal(['deal_id' => 1002, 'proposed_user_id' => 10451])->assertOk();

    expect(BitrixRoutingDailyBalance::query()->count())->toBe(2);
});

test('it rejects unauthenticated allocation writes', function () {
    $this->postJson('/api/internal/bitrix-routing/allocate', [])->assertUnauthorized();
});
