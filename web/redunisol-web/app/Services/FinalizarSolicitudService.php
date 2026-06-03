<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class FinalizarSolicitudService
{
    public function resolve(?string $sol, ?string $ntrans, ?string $linea): array
    {
        $requestedLinea = $linea;
        $linea = $this->normalizeLine($requestedLinea);
        $lineConfig = $this->requestedLineConfig($requestedLinea) ?? $this->defaultMetamapConfig();

        $result = [
            'linea' => $linea,
            'line_label' => $this->lineLabel($linea),
            'loan' => null,
            'metamap' => $this->metamapConfig($lineConfig),
            'error' => null,
        ];

        if (!$sol) {
            return $result;
        }

        if ($linea === 'its') {
            return $this->resolveIts($result, $sol);
        }

        return $this->resolveLegacy($result, $sol, $ntrans ?: '0', $linea);
    }

    public function fallbackLoanFromQuery(?string $monto, ?string $cuotas, ?string $nro): ?array
    {
        if (!$monto && !$cuotas && !$nro) {
            return null;
        }

        return [
            'solicitud' => (string) ($nro ?: ''),
            'ntrans' => '',
            'linea' => '',
            'nombre' => '',
            'monto_total' => (string) ($monto ?: ''),
            'monto_total_display' => $this->formatMoneyDisplay($monto),
            'monto_cuota' => '',
            'monto_cuota_display' => '',
            'cuotas' => (string) ($cuotas ?: ''),
            'prestamo_cft' => '',
            'prestamo_tem' => '',
            'prestamo_tna' => '',
            'prestamo_tea' => '',
            'numero_prestamo' => '',
            'capital_original' => '',
            'monto_prestamo' => '',
            'primer_vencimiento' => '',
            'vencimiento' => '',
        ];
    }

    private function resolveLegacy(array $result, string $sol, string $ntrans, string $linea): array
    {
        $client = $linea === 'fiat' ? 'fiat' : 'caja';
        $baseUrl = (string) config("finalizar.legacy_clients.{$client}.base_url", '');

        if ($baseUrl === '') {
            $result['error'] = 'La API de consulta de solicitudes no esta configurada.';

            return $result;
        }

        $url = rtrim($baseUrl, '/').'/api/redunisol/finSolicitud/'.rawurlencode($ntrans).'/'.rawurlencode($sol);

        try {
            $response = Http::timeout((int) config('finalizar.legacy_clients.timeout_seconds', 30))
                ->acceptJson()
                ->post($url);
        } catch (ConnectionException) {
            $result['error'] = 'No se pudo conectar con la API de consulta de solicitudes.';

            return $result;
        }

        if (!$response->successful()) {
            $result['error'] = 'La API de consulta de solicitudes respondio con error.';

            return $result;
        }

        $payload = $response->json();
        if (!is_array($payload)) {
            $payload = json_decode($response->body(), true);
        }

        if (!is_array($payload)) {
            $result['error'] = 'La API de consulta de solicitudes devolvio una respuesta invalida.';

            return $result;
        }

        $result['loan'] = $this->mapLegacyLoan($payload, $sol, $ntrans, $linea);
        $result['metamap']['metadata'] = $this->buildMetamapMetadata($result['loan'], $result['metamap']['doc_id']);

        return $result;
    }

    private function resolveIts(array $result, string $sol): array
    {
        $baseUrl = (string) config('finalizar.its.base_url', '');
        $apiKey = (string) config('finalizar.its.api_key', '');
        $user = (string) config('finalizar.its.user', '');
        $password = (string) config('finalizar.its.password', '');
        $timeout = (int) config('finalizar.its.timeout_seconds', 25);

        if ($baseUrl === '' || $apiKey === '' || $user === '' || $password === '') {
            $result['error'] = 'La API ITS no esta configurada.';

            return $result;
        }

        try {
            $tokenResponse = Http::timeout($timeout)
                ->withHeaders([
                    'API_KEY' => $apiKey,
                    'Authorization' => 'Basic '.base64_encode($user.':'.$password),
                    'Accept' => 'application/json',
                ])
                ->get(rtrim($baseUrl, '/').'/apis/gettoken');
        } catch (ConnectionException) {
            $result['error'] = 'No se pudo conectar con ITS.';

            return $result;
        }

        $token = $tokenResponse->json('token');
        if (!$tokenResponse->successful() || !$token) {
            $result['error'] = 'ITS no devolvio token valido.';

            return $result;
        }

        try {
            $solicitudResponse = Http::timeout($timeout)
                ->withHeaders([
                    'API_KEY' => $apiKey,
                    'Authorization' => 'Bearer '.$token,
                    'Accept' => 'application/json',
                ])
                ->get(rtrim($baseUrl, '/').'/apis/getsolicitud/'.rawurlencode($sol));
        } catch (ConnectionException) {
            $result['error'] = 'No se pudo consultar la solicitud ITS.';

            return $result;
        }

        $solicitud = $solicitudResponse->json('solicitud');
        if (!$solicitudResponse->successful() || !is_array($solicitud)) {
            $result['error'] = 'ITS no devolvio datos de solicitud.';

            return $result;
        }

        $inferredLine = $this->inferItsLine($solicitud);
        if ($inferredLine === null) {
            $result['error'] = 'No se pudo determinar la linea ITS para esta solicitud.';

            return $result;
        }

        $lineConfig = $this->lineConfig($inferredLine);
        $result['linea'] = $inferredLine;
        $result['line_label'] = $this->lineLabel($inferredLine);
        $result['metamap'] = $this->metamapConfig($lineConfig);
        $result['loan'] = $this->mapItsLoan($solicitud, $sol, $inferredLine);
        $result['metamap']['metadata'] = $this->buildMetamapMetadata($result['loan'], $result['metamap']['doc_id']);

        return $result;
    }

    private function mapLegacyLoan(array $payload, string $sol, string $ntrans, string $linea): array
    {
        return [
            'solicitud' => $sol,
            'ntrans' => $ntrans,
            'linea' => $linea,
            'nombre' => (string) Arr::get($payload, 'nombreSocio', ''),
            'monto_total' => (string) Arr::get($payload, 'montoAfinanciar', ''),
            'monto_total_display' => (string) Arr::get($payload, 'montoAfinanciar', ''),
            'monto_cuota' => (string) Arr::get($payload, 'cuotaResultante', ''),
            'monto_cuota_display' => $this->formatMoneyDisplay(Arr::get($payload, 'cuotaResultante')),
            'cuotas' => (string) Arr::get($payload, 'cuotas', ''),
            'prestamo_cft' => $this->ratePercent(Arr::get($payload, 'prestamoCFT')),
            'prestamo_tem' => $this->ratePercent(Arr::get($payload, 'prestamoTEM')),
            'prestamo_tna' => $this->ratePercent(Arr::get($payload, 'prestamoTNA')),
            'prestamo_tea' => $this->ratePercent(Arr::get($payload, 'prestamoTEA')),
            'numero_prestamo' => (string) Arr::get($payload, 'NumeroPrestamo', ''),
            'capital_original' => (string) Arr::get($payload, 'CapitalOriginal', ''),
            'monto_prestamo' => (string) Arr::get($payload, 'MontoPrestamo', ''),
            'primer_vencimiento' => (string) Arr::get($payload, 'PrimerVencimiento', ''),
            'vencimiento' => (string) Arr::get($payload, 'Vencimiento', ''),
        ];
    }

    private function mapItsLoan(array $payload, string $sol, string $linea): array
    {
        $neto = (float) Arr::get($payload, 'ayu_neto', 0);
        $capital = (float) Arr::get($payload, 'ayu_capital', 0);
        $gastos = (float) Arr::get($payload, 'ayu_gastos_originacion', 0);
        $cuota = (float) Arr::get($payload, 'ayu_valor_cuota', 0);
        $tna = (float) Arr::get($payload, 'ayu_tna', 0);
        $tem = $this->itsTem($tna);
        $tea = $this->itsTea($tem);
        $cftTea = $this->itsCftTea($tea, $capital, $gastos);
        $vencimiento = (string) Arr::get($payload, 'ayu_fecha_vencimiento', '');

        return [
            'solicitud' => $sol,
            'ntrans' => '',
            'linea' => $linea,
            'nombre' => trim((string) Arr::get($payload, 'per_nombre', '').' '.(string) Arr::get($payload, 'per_apellido', '')),
            'monto_total' => $this->decimalString($neto),
            'monto_total_display' => $this->formatMoneyDisplay($neto),
            'monto_cuota' => $this->decimalString($cuota),
            'monto_cuota_display' => $this->formatMoneyDisplay($cuota),
            'cuotas' => (string) ((int) Arr::get($payload, 'ayu_cant_cuotas', 0)),
            'prestamo_cft' => $cftTea === null ? '' : $this->ratePercent($cftTea),
            'prestamo_tem' => $this->ratePercent($tem),
            'prestamo_tna' => $this->ratePercent($tna),
            'prestamo_tea' => $this->ratePercent($tea),
            'numero_prestamo' => (string) Arr::get($payload, 'ayu_nro_comprobante', ''),
            'capital_original' => $this->decimalString($neto),
            'monto_prestamo' => $this->decimalString($capital),
            'primer_vencimiento' => $vencimiento,
            'vencimiento' => $vencimiento,
        ];
    }

    private function inferItsLine(array $payload): ?string
    {
        $aytNombre = Str::upper((string) Arr::get($payload, 'ayt_nombre', ''));
        $aytEmpId = (int) Arr::get($payload, 'ayt_emp_id', 0);

        return match (true) {
            str_contains($aytNombre, 'MEDICA') => 'medicarosario',
            str_contains($aytNombre, 'MUCI') && $aytEmpId === 1000 => 'muci',
            str_contains($aytNombre, 'MUCI') && $aytEmpId === 1003 => 'sanatorio_muci',
            str_contains($aytNombre, 'CAJA') && $aytEmpId === 1000 => 'caja',
            str_contains($aytNombre, 'CAJA') && $aytEmpId === 1003 => 'sanatorio_caja',
            default => null,
        };
    }

    private function metamapConfig(array $lineConfig): array
    {
        return [
            'client_id' => (string) config('finalizar.metamap.client_id', ''),
            'flow_id' => (string) ($lineConfig['flow_id'] ?? ''),
            'doc_id' => (string) ($lineConfig['doc_id'] ?? ''),
            'extra_html' => (string) ($lineConfig['extra_html'] ?? ''),
            'metadata' => null,
        ];
    }

    private function defaultMetamapConfig(): array
    {
        return [
            'flow_id' => (string) config('finalizar.metamap.default_flow_id', ''),
            'doc_id' => (string) config('finalizar.metamap.default_doc_id', ''),
            'extra_html' => (string) config('finalizar.metamap.default_extra_html', ''),
        ];
    }

    private function buildMetamapMetadata(array $loan, string $docId): array
    {
        return [
            'eSignature' => [
                'customVariables' => [
                    'variableKey' => ['title' => 'Solicitud', 'value' => $loan['solicitud'], 'documents' => [$docId]],
                    'variableKey2' => ['title' => 'Importe solicitado', 'value' => $loan['monto_total_display'], 'documents' => [$docId]],
                    'variableKey3' => ['title' => 'Cuotas a pagar', 'value' => $loan['cuotas'], 'documents' => [$docId]],
                    'variableKey4' => ['title' => 'Importe cuota', 'value' => $loan['monto_cuota_display'], 'documents' => [$docId]],
                    'variableKey5' => ['title' => 'TNA', 'value' => $this->withPercent($loan['prestamo_tna']), 'documents' => [$docId]],
                    'variableKey6' => ['title' => 'TEA', 'value' => $this->withPercent($loan['prestamo_tea']), 'documents' => [$docId]],
                    'variableKey7' => ['title' => 'CFT', 'value' => $this->withPercent($loan['prestamo_cft']), 'documents' => [$docId]],
                    'variableKey8' => ['title' => 'TEM', 'value' => $this->withPercent($loan['prestamo_tem']), 'documents' => [$docId]],
                    'variableKey9' => ['title' => 'NumeroPrestamo', 'value' => $loan['numero_prestamo'], 'documents' => [$docId]],
                    'variableKey10' => ['title' => 'Importe liquidado', 'value' => $loan['capital_original'], 'documents' => [$docId]],
                    'variableKey11' => ['title' => 'Importe total', 'value' => $loan['monto_prestamo'], 'documents' => [$docId]],
                    'variableKey12' => ['title' => 'Primer desc.hab.', 'value' => substr($loan['primer_vencimiento'], 0, 10), 'documents' => [$docId]],
                    'variableKey13' => ['title' => 'Vencimiento', 'value' => substr($loan['vencimiento'], 0, 10), 'documents' => [$docId]],
                ],
            ],
        ];
    }

    private function normalizeLine(?string $linea): string
    {
        return $this->matchedLineKey($linea) ?? (string) config('finalizar.default_line', 'caja');
    }

    private function requestedLineConfig(?string $linea): ?array
    {
        $matchedLine = $this->matchedLineKey($linea);

        if ($matchedLine === null || $matchedLine === 'its') {
            return null;
        }

        return $this->lineConfig($matchedLine);
    }

    private function matchedLineKey(?string $linea): ?string
    {
        $linea = trim((string) $linea);

        if ($linea === '') {
            return null;
        }

        if (Str::lower($linea) === 'its') {
            return 'its';
        }

        foreach (array_keys(config('finalizar.lines', [])) as $lineKey) {
            if (Str::lower($lineKey) === Str::lower($linea)) {
                return (string) $lineKey;
            }
        }

        return null;
    }

    private function lineConfig(string $linea): array
    {
        return config("finalizar.lines.{$linea}", config('finalizar.lines.'.config('finalizar.default_line', 'caja'), []));
    }

    private function lineLabel(string $linea): string
    {
        return Str::of($linea)->replace('_', ' ')->headline()->toString();
    }

    private function ratePercent(mixed $value): string
    {
        $number = $this->decimalFromMixed($value);

        return $number === null ? '' : number_format($number * 100, 2, '.', '');
    }

    private function formatMoneyDisplay(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '';
        }

        if (is_string($value) && str_contains($value, '$')) {
            return trim($value);
        }

        $number = $this->decimalFromMixed($value);

        return $number === null ? (string) $value : '$ '.number_format($number, 2, ',', '.');
    }

    private function decimalFromMixed(mixed $value): ?float
    {
        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }

        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        $value = str_replace(['$', ' '], '', $value);
        if (str_contains($value, ',') && str_contains($value, '.')) {
            $value = str_replace('.', '', $value);
            $value = str_replace(',', '.', $value);
        } else {
            $value = str_replace(',', '.', $value);
        }

        return is_numeric($value) ? (float) $value : null;
    }

    private function decimalString(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    private function withPercent(string $value): string
    {
        return $value === '' ? '' : $value.'%';
    }

    private function itsTem(float $tna): float
    {
        return ($tna * (360.0 / 365.0)) / 12.0;
    }

    private function itsTea(float $tem): float
    {
        return (1.0 + $tem) ** 12 - 1.0;
    }

    private function itsCftTea(float $tea, float $capital, float $gastos): ?float
    {
        if ($capital <= 0) {
            return null;
        }

        return $tea + ($gastos > 0 ? $gastos / $capital : 0.0);
    }
}
