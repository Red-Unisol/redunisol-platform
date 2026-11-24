<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use UnexpectedValueException;

/** Read-only enrichment of an already resolved loan. Never reads IDs from the URL. */
class FinalizarIvaService
{
    public function __construct(private FinalizarIvaRates $calculator) {}

    public function apply(array $loan, string $client): array
    {
        $base = (string) config("finalizar.legacy_clients.{$client}.evaluate_base_url", '');
        if ($base === '') {
            return $loan;
        }

        $empty = ['prestamo_tem' => '', 'prestamo_tna' => '', 'prestamo_tea' => '', 'prestamo_cft' => ''];
        $loan['lleva_iva'] = null;
        $loan['tasas_estado'] = 'unavailable';
        try {
            $number = (string) ($loan['numero_prestamo'] ?? '');
            if (! preg_match('/^[1-9][0-9]{0,14}$/D', $number)) {
                throw new UnexpectedValueException('Invalid loan number.');
            }
            $rows = $this->query($base, 'F.Module.Cuentas.Prestamos.Prestamo', "[NroCuenta] = {$number}",
                'NroCuenta;Iif([IVA] > 0, True, False);TasaInicial;MontoADesembolsar;Cuotas', 2);
            if (count($rows) !== 1 || ! is_array($rows[0]) || count($rows[0]) !== 5
                || (string) $rows[0][0] !== $number || ! is_bool($rows[0][1])) {
                throw new UnexpectedValueException('Invalid loan response.');
            }
            [, $hasIva, $initial, $net, $count] = $rows[0];
            $loan['lleva_iva'] = $hasIva;
            if (! $hasIva) {
                $loan['tasas_estado'] = 'original';

                return $loan;
            }
            $loan = array_replace($loan, $empty);
            if (is_numeric($initial)) {
                foreach ($this->calculator->interest((float) $initial) as $field => $rate) {
                    $loan[$field] = number_format($rate * 100, 2, '.', '');
                }
                $loan['tasas_estado'] = 'partial';
            }
            if (! is_numeric($net) || ! is_numeric($count) || (float) $count !== (float) (int) $count
                || (int) $count < 1 || (int) $count > 1000) {
                throw new UnexpectedValueException('Invalid cash flow parameters.');
            }
            $count = (int) $count;
            $rows = $this->query($base, 'F.Module.Cuentas.Prestamos.CuotaPrestamo',
                "[Prestamo.NroCuenta] = {$number}", 'NroCuota;Descripcion;MontoTotal', 2002);
            if (count($rows) >= 2002) {
                throw new UnexpectedValueException('Truncated installments.');
            }
            $payments = [];
            foreach ($rows as $row) {
                if (! is_array($row) || count($row) !== 3) {
                    throw new UnexpectedValueException('Invalid installment row.');
                }
                [$installment, $description, $amount] = $row;
                if (! is_numeric($installment) || (float) $installment !== (float) (int) $installment) {
                    throw new UnexpectedValueException('Invalid installment number.');
                }
                $installment = (int) $installment;
                // Existing core convention: PG/desembolso rows are not scheduled payments.
                // Installment zero is the financed initial charge, already reflected in net/plan.
                if ($installment <= 0 || ! is_string($description) || trim($description) !== "{$number}/{$installment}") {
                    continue;
                }
                if ($installment > $count || isset($payments[$installment]) || ! is_numeric($amount)) {
                    throw new UnexpectedValueException('Ambiguous installments.');
                }
                $payments[$installment] = (float) $amount;
            }
            ksort($payments);
            if (array_keys($payments) !== range(1, $count)) {
                throw new UnexpectedValueException('Incomplete installments.');
            }
            $loan['prestamo_cft'] = number_format($this->calculator->annualCost((float) $net, array_values($payments)) * 100, 2, '.', '');
            $loan['tasas_estado'] = $loan['prestamo_tem'] !== '' ? 'complete' : 'partial';

            return $loan;
        } catch (ConnectionException|RequestException|UnexpectedValueException|InvalidArgumentException $e) {
            // Signing remains available by business decision. No source payloads or PII in logs.
            return $loan['lleva_iva'] === true ? $loan : array_replace($loan, $empty);
        }
    }

    private function query(string $base, string $type, string $criteria, string $fields, int $max): array
    {
        $rows = Http::connectTimeout(5)->timeout(10)->acceptJson()
            ->post(rtrim($base, '/').'/api/Empresa/EvaluateList', [
                'tipo' => $type, 'cmd' => $criteria, 'campos' => $fields, 'max' => $max,
            ])->throw()->json();
        // Vimarx negotiates application/json as a JSON string containing the rows.
        // Other clients receive the array directly. Both shapes are verified.
        if (is_string($rows)) {
            $rows = json_decode($rows, true);
        }
        if (! is_array($rows) || ! array_is_list($rows)) {
            throw new UnexpectedValueException('Invalid legacy response.');
        }

        return $rows;
    }
}
