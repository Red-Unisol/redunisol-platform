<?php

namespace App\Services;

use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;
use RuntimeException;
use Throwable;

class BcraReport
{
    private const BASE_URL = 'https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/';

    public function consult(string $cuit): ?array
    {
        $paths = ['current' => $cuit, 'history' => 'Historicas/'.$cuit];
        $reports = [];

        // Keep successful endpoints during retries. Never return a partially refreshed report.
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                $responses = Http::pool(function (Pool $pool) use ($paths, $reports) {
                    $requests = [];
                    foreach ($paths as $key => $path) {
                        if (! array_key_exists($key, $reports)) {
                            $requests[] = $pool->as($key)->acceptJson()->connectTimeout(3)
                                ->timeout(8)->get(self::BASE_URL.$path);
                        }
                    }

                    return $requests;
                });

                foreach ($responses as $key => $response) {
                    try {
                        $reports[$key] = $this->periods($response, $cuit);
                    } catch (Throwable) {
                        // HTTP, transport and malformed responses all use the same bounded retry.
                    }
                }
                if (count($reports) === 2) {
                    return $this->normalize($reports['current'], $reports['history']);
                }
            } catch (Throwable) {
                // An unavailable BCRA must not break the CredixSA report.
            }

            if ($attempt < 3) {
                Sleep::for(12)->seconds();
            }
        }

        Log::warning('BCRA report unavailable after 3 attempts; keeping CredixSA.');

        return null;
    }

    private function periods(mixed $response, string $cuit): array
    {
        if (! $response instanceof Response) {
            throw new RuntimeException('BCRA transport error');
        }
        $payload = $response->json();
        // A documented no-records response is data, not an outage or a generic HTTP 404.
        if ($response->status() === 404 && is_array($payload)
            && ($payload['status'] ?? null) === 404
            && is_array($payload['errorMessages'] ?? null)
            && preg_match('/no se encontr.*datos.*identifica/iu', implode(' ', $payload['errorMessages']))) {
            return [];
        }
        $results = $payload['results'] ?? null;
        if (! $response->successful() || ($payload['status'] ?? null) !== 200
            || ! is_array($results) || (string) ($results['identificacion'] ?? '') !== $cuit
            || ! is_array($results['periodos'] ?? null)) {
            throw new RuntimeException('Invalid BCRA response');
        }

        $periods = [];
        foreach ($results['periodos'] as $period) {
            $label = (string) ($period['periodo'] ?? '');
            if (! preg_match('/^\d{4}(0[1-9]|1[0-2])$/', $label)
                || ! is_array($period['entidades'] ?? null) || isset($periods[$label])) {
                throw new RuntimeException('Invalid BCRA period');
            }
            $entities = [];
            foreach ($period['entidades'] as $entity) {
                $name = trim((string) ($entity['entidad'] ?? ''));
                $situation = filter_var($entity['situacion'] ?? null, FILTER_VALIDATE_INT);
                $amount = $entity['monto'] ?? null;
                if ($name === '' || $situation === false || $situation < 1 || $situation > 6
                    || ! is_numeric($amount) || ! is_finite((float) $amount) || $amount < 0
                    || $amount > PHP_INT_MAX / 100000 || isset($entities[$name])) {
                    throw new RuntimeException('Invalid BCRA entity');
                }
                // The official API expresses amounts in thousands of pesos. Work in cents.
                $entities[$name] = [
                    'situacion' => (string) $situation,
                    'cents' => (int) round((float) $amount * 100000),
                    'observacion' => implode(' · ', array_filter([
                        ! empty($entity['enRevision']) ? 'En revisión' : '',
                        ! empty($entity['procesoJud']) ? 'Proceso judicial' : '',
                    ])),
                ];
            }
            $periods[$label] = $entities;
        }
        krsort($periods);

        return $periods;
    }

    private function money(int $cents): string
    {
        return '$ '.number_format($cents / 100, $cents % 100 === 0 ? 0 : 2, ',', '.');
    }

    private function periodLabel(string $period): string
    {
        return substr($period, 4, 2).'/'.substr($period, 0, 4);
    }

    private function normalize(array $current, array $history): array
    {
        $active = [];
        $debts = [];
        $total = 0;
        $negative = 0;
        foreach ($current as $period => $entities) {
            foreach ($entities as $name => $entity) {
                // Deudas can contain different reporting months; use the latest for each entity.
                if (isset($active[$name])) {
                    continue;
                }
                $active[$name] = true;
                $total += $entity['cents'];
                if ((int) $entity['situacion'] >= 2) {
                    $negative += $entity['cents'];
                }
                $debts[] = [
                    'entidad' => $name, 'periodo' => $this->periodLabel((string) $period),
                    'situacion' => $entity['situacion'], 'monto' => $this->money($entity['cents']),
                    'observacion' => $entity['observacion'],
                ];
            }
        }

        // Include the fresh current month even when Historicas has not incorporated it yet.
        foreach ($current as $period => $entities) {
            $history[$period] = array_replace($history[$period] ?? [], $entities);
        }
        krsort($history);
        $periods = [];
        $years = [];
        $months = [];
        $monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        if ($history !== []) {
            $latest = (string) array_key_first($history);
            $date = \DateTimeImmutable::createFromFormat('!Ym', $latest);
            for ($i = 0; $i < 24; $i++) {
                $periods[] = $date->format('Ym');
                $year = $date->format('Y');
                $last = array_key_last($years);
                if ($last !== null && $years[$last]['anio'] === $year) {
                    $years[$last]['span']++;
                } else {
                    $years[] = ['anio' => $year, 'span' => 1];
                }
                $months[] = $monthNames[(int) $date->format('n') - 1];
                $date = $date->modify('-1 month');
            }
        }
        $names = [];
        foreach ($periods as $period) {
            foreach ($history[$period] ?? [] as $name => $entity) {
                $names[$name] ??= $entity;
            }
        }
        $rows = [];
        foreach ($names as $name => $latest) {
            $rows[] = [
                'entidad' => $name,
                'situaciones' => array_map(fn ($period) => $history[$period][$name]['situacion'] ?? '-', $periods),
                'ultimo_monto_informado' => $this->money($latest['cents']),
                'observacion' => $latest['observacion'], 'activa' => isset($active[$name]),
            ];
        }
        $evolution = [];
        foreach ($periods as $period) {
            $cells = [];
            foreach ($names as $name => $_) {
                $entity = $history[$period][$name] ?? null;
                $cells[] = [
                    'entidad' => $name, 'situacion' => $entity['situacion'] ?? '',
                    'monto' => $entity !== null ? $this->money($entity['cents']) : '',
                ];
            }
            $evolution[] = ['periodo' => $this->periodLabel($period), 'celdas' => $cells];
        }

        return [
            'fuente' => 'BCRA', 'consultado_en' => now()->toIso8601String(),
            'resumen' => [], 'entidades' => array_keys($active),
            'deudas_vigentes' => $debts, 'deuda_vigente_total' => $this->money($total),
            'deuda_situacion_negativa_total' => $this->money($negative),
            'mensaje' => $debts === [] ? 'Sin deudas vigentes informadas por BCRA.' : '',
            'deudas_24_meses' => ['fuente' => 'BCRA', 'anios' => $years, 'meses' => $months, 'filas' => $rows],
            'evolucion_deuda_por_entidad' => ['fuente' => 'BCRA', 'entidades' => array_keys($names), 'filas' => $evolution],
            'historial_por_entidad' => [],
        ];
    }
}
