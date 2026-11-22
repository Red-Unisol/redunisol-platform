<?php

use App\Services\FinalizarIvaRates;

it('derives nominal and effective rates from the initial VAT-inclusive rate', function () {
    $rates = (new FinalizarIvaRates)->interest(0.121);
    expect($rates['prestamo_tem'])->toEqualWithDelta(0.1, 1e-12)
        ->and($rates['prestamo_tna'])->toEqualWithDelta(1.2, 1e-12)
        ->and($rates['prestamo_tea'])->toEqualWithDelta(2.138428376721, 1e-12);
});

it('matches the monthly cash flow example including the last installment rounding', function () {
    $payments = array_fill(0, 12, 186513.37);
    $payments[11] = 186513.48;
    $rate = (new FinalizarIvaRates)->annualCost(1000000, $payments);
    expect(number_format($rate * 100, 2, '.', ''))->toBe('449.59');
});

it('matches four RATE examples independently checked against the supplied workbook', function ($months, $payment, $monthly) {
    $annual = (new FinalizarIvaRates)->annualCost(1000000, array_fill(0, $months, $payment));
    expect($annual)->toEqualWithDelta((1 + $monthly) ** 12 - 1, 1e-9);
})->with([
    [6, 264048.4874170675, 0.14973519819242784],
    [12, 168777.81236533044, 0.1297265112915574],
    [18, 140219.75555559513, 0.12278196255589867],
    [24, 127994.74280329101, 0.11946491064960602],
]);

it('supports zero and negative costs and long payment plans', function () {
    $calculator = new FinalizarIvaRates;
    expect($calculator->annualCost(120, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]))->toEqualWithDelta(0, 1e-10)
        ->and($calculator->annualCost(100, [90]))->toBeLessThan(0)
        ->and($calculator->annualCost(100, array_fill(0, 1000, 1.0)))->toBeGreaterThan(0);
});

it('rejects invalid flows rather than inventing a cost', function ($net, $payments) {
    expect(fn () => (new FinalizarIvaRates)->annualCost($net, $payments))->toThrow(InvalidArgumentException::class);
})->with([[0, [10]], [100, []], [100, [0]], [100, [-10]], [INF, [10]], [100, [NAN]]]);
