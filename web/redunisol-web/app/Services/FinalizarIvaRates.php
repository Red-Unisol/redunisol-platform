<?php

namespace App\Services;

use InvalidArgumentException;

/** Monthly, end-of-period cash flows; annual rates are effective, not nominal. */
class FinalizarIvaRates
{
    public function interest(float $tasaInicial): array
    {
        if (! is_finite($tasaInicial) || $tasaInicial < 0) {
            throw new InvalidArgumentException('Invalid initial rate.');
        }

        $tem = $tasaInicial / 1.21;
        $tea = (1 + $tem) ** 12 - 1;
        if (! is_finite($tea) || ! is_finite($tem * 12)) {
            throw new InvalidArgumentException('Invalid effective rate.');
        }

        return ['prestamo_tem' => $tem, 'prestamo_tna' => $tem * 12, 'prestamo_tea' => $tea];
    }

    /** @param array<int, float> $payments Original installments, including VAT. */
    public function annualCost(float $net, array $payments): float
    {
        if (! is_finite($net) || $net <= 0 || $payments === []) {
            throw new InvalidArgumentException('Invalid cash flows.');
        }
        foreach ($payments as $payment) {
            if (! is_finite($payment) || $payment <= 0) {
                throw new InvalidArgumentException('Invalid installment.');
            }
        }

        // Positive future payments and one initial disbursement give a unique root.
        $presentValue = static function (float $rate) use ($payments): float {
            $sum = 0.0;
            foreach (array_reverse(array_values($payments)) as $payment) {
                $sum = ($sum + $payment) / (1 + $rate);
            }

            return $sum;
        };
        $low = -0.999;
        $high = 1.0;
        while ($presentValue($high) > $net && $high < 1e6) {
            $high *= 2;
        }
        if ($presentValue($high) > $net || $presentValue($low) < $net) {
            throw new InvalidArgumentException('Cash flow root not bracketed.');
        }
        for ($i = 0; $i < 180; $i++) {
            $mid = ($low + $high) / 2;
            if ($presentValue($mid) > $net) {
                $low = $mid;
            } else {
                $high = $mid;
            }
        }
        $annual = (1 + ($low + $high) / 2) ** 12 - 1;
        if (! is_finite($annual)) {
            throw new InvalidArgumentException('Invalid annual cost.');
        }

        return $annual;
    }
}
