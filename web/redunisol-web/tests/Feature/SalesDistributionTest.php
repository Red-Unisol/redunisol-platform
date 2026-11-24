<?php

use App\Services\EdnaBitrix;
use Illuminate\Support\Facades\Artisan;

it('counts distinct chats, repeated events, mixed handling and pending separately', function () {
    $this->travelTo(now()->setDate(2026, 11, 24)->setTime(16, 0));
    $crm = Mockery::mock(EdnaBitrix::class);
    app()->instance(EdnaBitrix::class, $crm);
    $sessions = [];
    foreach ([1 => 10, 2 => 10, 3 => 30, 4 => 40] as $id => $chatId) {
        $sessions[] = ['id' => $id, 'chatId' => $chatId, 'configId' => 1, 'dateCreate' => '2026-11-24T10:01:00-03:00'];
    }
    $crm->shouldReceive('call')->once()->with('imopenlines.v2.Session.list', Mockery::type('array'))
        ->andReturn(['sessions' => $sessions, 'hasNextPage' => false]);
    $rows = [];
    foreach ([[1, 71283], [2, 74827], [2, 57], [3, 0]] as [$session, $actor]) {
        $rows[] = ['sessionId' => $session, 'type' => 'USER', 'initiatorId' => $actor, 'toOperatorId' => 12, 'fromOperatorId' => 34,
            'date' => '2026-11-24T10:05:00-03:00', 'mode' => $actor ? 'MANUAL' : 'AUTO', 'reason' => $actor ? 'manual' : 'auto'];
    }
    $crm->shouldReceive('call')->once()->with('imopenlines.v2.Session.Transfer.list', Mockery::any())->andReturn(['transfers' => $rows]);
    $crm->shouldReceive('call')->once()->with('imopenlines.v2.Session.Stat.get', Mockery::any())->andReturn(['sessions' => array_map(fn ($id, $n) => ['sessionId' => $id, 'transfersCount' => $n], [1, 2, 3, 4], [1, 2, 1, 0])]);
    expect(Artisan::call('sales:distribution', ['--day' => '2026-11-24']))->toBe(0);
    $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    expect($data['chats_by_distribution'])->toBe(['only_automatic' => 1, 'only_human' => 0, 'both' => 1,
        'attribution_incomplete' => 0, 'no_transfer' => 1])
        ->and($data['native_transfer_counts'])->toBe(['automatic' => 2, 'human' => 2, 'unattributed' => 0])
        ->and($data['unique_chats'])->toBe(3)->and($data['human_work_pct_fully_attributed'])->toBe(50);
});

it('counts next-day transfers only before the exact 24h anniversary for a mature opening cohort', function () {
    $this->travelTo(now()->setDate(2026, 11, 24));
    $crm = Mockery::mock(EdnaBitrix::class);
    app()->instance(EdnaBitrix::class, $crm);
    $crm->shouldReceive('call')->once()->with('imopenlines.v2.Session.list', Mockery::any())->andReturn(['sessions' =>
        [['id' => 1, 'configId' => 1, 'chatId' => 10, 'dateCreate' => '2026-11-20T12:30:00-03:00']], 'hasNextPage' => false]);
    $event = ['sessionId' => 1, 'type' => 'USER', 'fromOperatorId' => 1, 'toOperatorId' => 2];
    $crm->shouldReceive('call')->once()->with('imopenlines.v2.Session.Transfer.list', Mockery::any())->andReturn(['transfers' => [
        $event + ['date' => '2026-11-20T12:29:59-03:00', 'initiatorId' => 57],
        $event + ['date' => '2026-11-21T12:29:59-03:00', 'initiatorId' => 71283],
        $event + ['date' => '2026-11-21T12:30:00-03:00', 'initiatorId' => 74827],
    ]]);
    $crm->shouldReceive('call')->once()->with('imopenlines.v2.Session.Stat.get', Mockery::any())
        ->andReturn(['sessions' => [['sessionId' => 1, 'transfersCount' => 3]]]);
    expect(Artisan::call('sales:distribution', ['--day' => '2026-11-20', '--first-24-hours' => true]))->toBe(0);
    $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    expect($data['transfer_window'])->toBe('first_24_hours_per_session')
        ->and($data['native_transfer_counts'])->toBe(['automatic' => 1, 'human' => 0, 'unattributed' => 0]);
    expect(Artisan::call('sales:distribution', ['--day' => '2026-11-24', '--first-24-hours' => true]))->toBe(2);
});

it('withholds the report if native event totals and returned transfers disagree', function () {
    $crm = Mockery::mock(EdnaBitrix::class);
    app()->instance(EdnaBitrix::class, $crm);
    $crm->shouldReceive('call')->with('imopenlines.v2.Session.list', Mockery::any())->andReturn(['sessions' => [['id' => 1, 'chatId' => 10, 'configId' => 1, 'dateCreate' => '2026-11-20T10:01:00-03:00']], 'hasNextPage' => false]);
    $crm->shouldReceive('call')->with('imopenlines.v2.Session.Transfer.list', Mockery::any())->andReturn(['transfers' => []]);
    $crm->shouldReceive('call')->with('imopenlines.v2.Session.Stat.get', Mockery::any())->andReturn(['sessions' => [['sessionId' => 1, 'transfersCount' => 2]]]);
    $this->travelTo(now()->setDate(2026, 11, 24));
    expect(fn () => Artisan::call('sales:distribution', ['--day' => '2026-11-20']))->toThrow(RuntimeException::class, 'Incomplete native transfer history.');
});

it('excludes only an exactly verified default-owner restoration and retains the business transfer on the same chat', function () {
    $this->travelTo(now()->setDate(2026, 11, 24));
    $crm = Mockery::mock(EdnaBitrix::class);
    app()->instance(EdnaBitrix::class, $crm);
    $crm->shouldReceive('call')->with('imopenlines.v2.Session.list', Mockery::any())->andReturn(['sessions' =>
        [['id' => 313689, 'configId' => 1, 'chatId' => 143827, 'dateCreate' => '2026-11-10T10:10:00-03:00']], 'hasNextPage' => false]);
    $event = ['sessionId' => 313689, 'type' => 'USER', 'fromOperatorId' => 71283, 'toOperatorId' => 57, 'initiatorId' => 71283];
    $crm->shouldReceive('call')->with('imopenlines.v2.Session.Transfer.list', Mockery::any())->andReturn(['transfers' => [
        $event + ['date' => '2026-11-10T20:42:35+03:00'], $event + ['date' => '2026-11-10T20:43:35+03:00'],
    ]]);
    $crm->shouldReceive('call')->with('imopenlines.v2.Session.Stat.get', Mockery::any())->andReturn(['sessions' => [['sessionId' => 313689, 'transfersCount' => 2]]]);
    expect(Artisan::call('sales:distribution', ['--day' => '2026-11-10']))->toBe(0);
    $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    expect($data['technical_restorations'])->toBe(1)->and($data['native_transfer_counts']['automatic'])->toBe(1);
});
