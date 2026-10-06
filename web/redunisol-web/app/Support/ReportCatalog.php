<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class ReportCatalog
{
    private const AREAS = [
        'analisis-credito' => 'Análisis de crédito',
        'cobranzas' => 'Cobranzas',
        'contabilidad' => 'Contabilidad',
        'marketing' => 'Marketing',
    ];

    private const REPORTS = [
        'analisis-credito/reporte-evaluacion' => [
            'title' => 'Reporte de evaluación',
            'description' => 'Evaluaciones crediticias acumuladas para el período mensual seleccionado.',
        ],
        'analisis-credito/reporte-evaluacion-comisiones' => [
            'title' => 'Evaluación y comisiones',
            'description' => 'Objetivos sobre los tres meses anteriores, feriados nacionales y comisiones. Legajos pendientes de revisión humana.',
        ],
        'analisis-credito/tope-descuento-caja' => [
            'title' => 'Tope de descuento de Caja',
            'description' => 'Consultas de cupo y topes de descuento utilizados en el análisis crediticio.',
        ],
        'cobranzas/mudon-jubilados' => [
            'title' => 'MUDON Jubilados',
            'description' => 'Padrón de socios con créditos activos, enriquecido con información de CredixSA.',
        ],
        'contabilidad/transferencias-app' => [
            'title' => 'Transferencias de la app',
            'description' => 'Seguimiento de transferencias, cancelaciones y tiempos operativos de la aplicación.',
        ],
        'marketing/distribucion-negociaciones' => [
            'title' => 'Distribución de negociaciones',
            'description' => 'Resultados diarios de clasificación y asignación de negociaciones comerciales.',
        ],
        'marketing/formulario-bitrix' => [
            'title' => 'Formulario Bitrix',
            'description' => 'Seguimiento diario de formularios recibidos y procesados en Bitrix24.',
        ],
    ];

    public function groups(Collection $reports): Collection
    {
        return $reports
            ->groupBy(fn (array $report): string => $this->groupKey($report['path']))
            ->map(function (Collection $files, string $key): array {
                $files = $files->sortByDesc('modified_at')->values();
                $latest = $files->first(
                    fn (array $file): bool => strtolower(pathinfo($file['name'], PATHINFO_FILENAME)) === 'ultimo'
                ) ?? $files->first();
                $metadata = self::REPORTS[$key] ?? [];
                $segments = explode('/', $key);
                $areaKey = $segments[0];
                $reportKey = $segments[count($segments) - 1];

                return [
                    'key' => $key,
                    'area' => self::AREAS[$areaKey] ?? Str::headline($areaKey),
                    'title' => $metadata['title'] ?? Str::headline($reportKey),
                    'description' => $metadata['description'] ?? 'Archivos disponibles para este reporte.',
                    'latest' => $latest,
                    'history' => $files
                        ->reject(fn (array $file): bool => $file['path'] === $latest['path'])
                        ->values(),
                ];
            })
            ->sortByDesc(fn (array $group): int => $group['latest']['modified_at'])
            ->values();
    }

    private function groupKey(string $path): string
    {
        $directory = trim(str_replace('\\', '/', dirname($path)), '/.');

        if ($directory === '') {
            return 'general';
        }

        $segments = explode('/', $directory);

        if (end($segments) === 'historico') {
            array_pop($segments);
        }

        return $segments === [] ? 'general' : implode('/', $segments);
    }
}
