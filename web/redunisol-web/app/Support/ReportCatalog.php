<?php

namespace App\Support;

use Illuminate\Support\Carbon;
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
            'domain' => 'analisis-credito',
            'flow' => 'reporte_evaluacion_management',
            'description' => 'Evaluaciones crediticias acumuladas para el período mensual seleccionado.',
        ],
        'analisis-credito/reporte-evaluacion-comisiones' => [
            'title' => 'Evaluación y comisiones',
            'domain' => 'analisis-credito',
            'flow' => 'reporte_evaluacion_comisiones_management',
            'description' => 'Objetivos sobre los tres meses anteriores, feriados nacionales y comisiones. Legajos pendientes de revisión humana.',
        ],
        'analisis-credito/tope-descuento-caja' => [
            'title' => 'Tope de descuento de Caja',
            'domain' => 'analisis-credito',
            'flow' => 'tope_descuento_caja_mensual',
            'description' => 'Consultas de cupo y topes de descuento utilizados en el análisis crediticio.',
        ],
        'cobranzas/mudon-jubilados' => [
            'title' => 'MUDON Jubilados',
            'domain' => 'analisis-credito',
            'flow' => 'mudon_credixsa_report',
            'description' => 'Padrón de socios con créditos activos, enriquecido con información de CredixSA.',
        ],
        'contabilidad/transferencias-app' => [
            'title' => 'Transferencias de la app',
            'domain' => 'contabilidad',
            'flow' => 'transfer_trace_report_daily',
            'description' => 'Seguimiento de transferencias, cancelaciones y tiempos operativos de la aplicación.',
        ],
        'marketing/distribucion-negociaciones' => [
            'title' => 'Distribución de negociaciones',
            'domain' => 'marketing-crm',
            'flow' => 'commercial_distribution_report_daily',
            'description' => 'Resultados diarios de clasificación y asignación de negociaciones comerciales.',
        ],
        'marketing/formulario-bitrix' => [
            'title' => 'Formulario Bitrix',
            'domain' => 'marketing-crm',
            'flow' => 'form_management_report_daily',
            'description' => 'Seguimiento diario de formularios recibidos y procesados en Bitrix24.',
        ],
    ];

    public function groups(Collection $reports): Collection
    {
        return $reports
            ->groupBy(fn (array $report): string => $this->groupKey($report['path']))
            ->only(array_keys(self::REPORTS))
            ->map(function (Collection $files, string $key): array {
                $files = $files->map(fn (array $file): array => [
                    ...$file,
                    'download_name' => $this->downloadName($file),
                ])->sortByDesc('modified_at')->values();
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
                    'regenerable' => isset($metadata['flow']),
                    'latest' => $latest,
                    'history' => $files
                        ->reject(fn (array $file): bool => $file['path'] === $latest['path'])
                        ->values(),
                ];
            })
            ->sortByDesc(fn (array $group): int => $group['latest']['modified_at'])
            ->values();
    }

    public function definition(string $key): ?array
    {
        return self::REPORTS[$key] ?? null;
    }

    public function downloadName(array $report): string
    {
        $key = $this->groupKey($report['path']);
        if ($key === 'general') {
            return basename($report['path']);
        }

        $title = self::REPORTS[$key]['title'] ?? Str::headline(basename($key));
        $stem = pathinfo($report['path'], PATHINFO_FILENAME);
        $date = strtolower($stem) === 'ultimo'
            ? Carbon::createFromTimestamp($report['modified_at'], 'America/Argentina/Buenos_Aires')->format('Y-m-d_His')
            : Str::slug($stem);

        return Str::slug($title).'-'.$date.'.'.strtolower(pathinfo($report['path'], PATHINFO_EXTENSION));
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
