<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class BcraPresentations
{
    public const ARTIFACTS = [
        'zip' => 'output/informacion.zip', 'config' => 'config_aplicada.json',
        'control' => 'control/reporte_control.json', 'errors' => 'control/errores.csv',
        'excel' => 'control/deudores_por_superior.xlsx',
    ];

    public function configured(): bool
    {
        return config('bcra.kestra_url') !== '' && config('bcra.kestra_username') !== ''
            && config('bcra.kestra_password') !== '' && config('analisis.core_url') !== '';
    }

    private function normal(string $value): string
    {
        return preg_replace('/\s+/u', ' ', mb_strtoupper(trim($value)));
    }

    public function catalog(bool $fresh = false): array
    {
        $key = 'bcra:catalog:v1:'.hash('sha256', config('analisis.core_url').config('analisis.core_token'));
        $fetch = function () {
            $http = Http::accept('text/plain')->connectTimeout(5)->timeout(30)
                ->withOptions(['verify' => config('analisis.verify_tls')]);
            if (config('analisis.core_token')) {
                $http = $http->withToken(config('analisis.core_token'));
            }
            $response = $http->post(rtrim(config('analisis.core_url'), '/').'/api/Empresa/EvaluateList', [
                'tipo' => 'F.Module.Cuentas.Prestamos.LineaPrestamo', 'cmd' => '',
                'campos' => 'ID;Descripcion;Superior.ID;Superior.Descripcion', 'max' => 10001,
            ]);
            $rows = $response->json();
            if (is_string($rows)) {
                $rows = json_decode($rows, true);
            }
            if (! $response->successful() || ! is_array($rows) || ! array_is_list($rows)
                || count($rows) === 0 || count($rows) >= 10001) {
                throw new RuntimeException('Incomplete BCRA source catalog.');
            }
            $excluded = array_map($this->normal(...), config('bcra.excluded_superiors'));
            $medica = array_map($this->normal(...), config('bcra.excluded_cuad_products'));
            $lines = [];
            foreach ($rows as $row) {
                if (! is_array($row) || count($row) !== 4 || ! ctype_digit((string) $row[0])
                    || (! is_string($row[1]) && $row[1] !== null)) {
                    throw new RuntimeException('Invalid BCRA catalog row.');
                }
                $id = (string) $row[0];
                if (isset($lines[$id])) {
                    throw new RuntimeException('Duplicate BCRA catalog ID.');
                }
                $sourceName = trim((string) $row[1]);
                $name = $sourceName !== '' ? $sourceName : "Sin descripción (#{$id})";
                $superior = trim((string) ($row[3] ?? ''));
                $superior = $superior !== '' ? $superior : $name;
                $isExcluded = in_array($this->normal($superior), $excluded, true)
                    || in_array($this->normal($name), $excluded, true)
                    || ($this->normal($superior) === 'HABERES CUAD SANTA FE'
                        && in_array($this->normal($name), $medica, true));
                $lines[$id] = ['id' => $id, 'name' => $name, 'source_name' => $sourceName,
                    'superior_id' => (string) ($row[2] ?? $id), 'superior_name' => $superior,
                    'included_by_default' => ! $isExcluded,
                    'normal_until_66_by_default' => $this->normal($superior) === 'HABERES DESCUENTO POLICIA CBA'];
            }
            $lines = array_values($lines);
            usort($lines, fn ($a, $b) => strnatcasecmp($a['superior_name'].' '.$a['name'], $b['superior_name'].' '.$b['name']));

            return $lines;
        };
        $lines = $fresh ? $fetch() : Cache::remember($key, 300, $fetch);

        return ['lines' => $lines, 'excluded_cuits' => config('bcra.excluded_cuits'),
            'preset' => 'julio-2026-v2', 'company' => 'Celesol',
            'balance_basis' => 'VIMARX_CURRENT_BALANCE'];
    }

    private function kestra()
    {
        if (! $this->configured()) {
            throw new RuntimeException('BCRA execution is not configured.');
        }

        return Http::acceptJson()->withBasicAuth(config('bcra.kestra_username'), config('bcra.kestra_password'))
            ->connectTimeout(5)->timeout(30);
    }

    private function api(): string
    {
        return config('bcra.kestra_url').'/api/v1/'.rawurlencode(config('bcra.tenant'));
    }

    public function start(array $data): array
    {
        if ($data['period'] >= now('America/Argentina/Buenos_Aires')->format('Y-m')) {
            throw ValidationException::withMessages(['period' => 'Elegí un mes cerrado.']);
        }
        $catalog = $this->catalog(true)['lines'];
        $ids = array_column($catalog, 'id');
        $superiors = array_values(array_unique(array_column($catalog, 'superior_id')));
        if (array_diff($data['selected_line_ids'], $ids)) {
            throw ValidationException::withMessages(['selected_line_ids' => 'Cambió el catálogo. Actualizá las líneas y volvé a intentar.']);
        }
        if (array_diff($data['normal_until_66_superior_ids'], $superiors)) {
            throw ValidationException::withMessages(['normal_until_66_superior_ids' => 'La regla de 66 días contiene un superior desconocido.']);
        }
        $data['run_id'] = (string) Str::uuid();
        $data['rate'] = $data['granted_without_real_guarantee'] ? str_pad($data['rate'], 6, '0', STR_PAD_LEFT) : '000,00';
        if (strlen(json_encode($data, JSON_THROW_ON_ERROR)) > 60000) {
            throw ValidationException::withMessages(['excluded_cuits' => 'La configuración es demasiado grande. Reducí el tamaño de las listas de exclusiones.']);
        }
        $response = $this->kestra()->asMultipart()->post($this->api().'/executions/'
            .rawurlencode(config('bcra.namespace')).'/'.config('bcra.flow_id'), [
                'request' => json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
            ]);
        $id = $response->json('id');
        if (! $response->successful() || ! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{10,100}$/', $id)) {
            // A timeout may have created an execution. Never retry a start automatically.
            throw new RuntimeException('Could not confirm BCRA execution.');
        }

        return ['execution_id' => $id, 'run_id' => $data['run_id'], 'status' => 'CREATED'];
    }

    public function status(string $execution): array
    {
        abort_unless(preg_match('/^[A-Za-z0-9_-]{10,100}$/', $execution), 404);
        $response = $this->kestra()->get($this->api().'/executions/'.rawurlencode($execution));
        if ($response->status() === 404) {
            abort(404);
        }
        if (! $response->successful()) {
            throw new RuntimeException('Could not read BCRA execution.');
        }
        $data = $response->json();
        abort_unless(($data['namespace'] ?? '') === config('bcra.namespace') && ($data['flowId'] ?? '') === config('bcra.flow_id'), 404);
        $request = $data['inputs']['request'] ?? [];
        if (is_string($request)) {
            $request = json_decode($request, true) ?: [];
        }
        $runId = $request['run_id'] ?? '';
        abort_unless(Str::isUuid($runId), 404);
        $state = $data['state']['current'] ?? 'CREATED';
        $metadata = $this->metadata($runId);
        if (($metadata['status'] ?? '') === 'RUNNING' && in_array($state, ['SUCCESS', 'FAILED', 'KILLED', 'CANCELLED', 'WARNING'], true)) {
            $metadata['status'] = $state === 'SUCCESS' ? 'FAILED' : $state;
            $metadata['message'] = 'La ejecución terminó sin completar los archivos de esta corrida.';
        }

        return ['execution_id' => $execution, 'execution_state' => $state, 'run_id' => $runId,
            'status' => $metadata['status'] ?? $state, 'metadata' => $metadata,
            'downloads' => $metadata ? $this->downloads($metadata) : []];
    }

    public function metadata(string $run): ?array
    {
        abort_unless(Str::isUuid($run), 404);
        $path = rtrim(config('bcra.output_root'), '/\\').DIRECTORY_SEPARATOR.$run.DIRECTORY_SEPARATOR.'metadata.json';
        if (! is_file($path)) {
            return null;
        }
        $data = json_decode(file_get_contents($path), true);
        if (! is_array($data) || ($data['run_id'] ?? '') !== $run) {
            throw new RuntimeException('Invalid BCRA run metadata.');
        }

        return $data;
    }

    public function downloads(array $metadata): array
    {
        $downloads = [];
        foreach (self::ARTIFACTS as $key => $relative) {
            if (isset($metadata['artifacts'][$key]) && ($key !== 'zip' || in_array($metadata['status'], ['SUCCESS', 'NEEDS_REVIEW'], true))) {
                $downloads[$key] = route('bcra.download', ['run' => $metadata['run_id'], 'artifact' => $key]);
            }
        }

        return $downloads;
    }

    public function history(): array
    {
        $paths = glob(rtrim(config('bcra.output_root'), '/\\').'/*/metadata.json') ?: [];
        $rows = [];
        foreach ($paths as $path) {
            $run = basename(dirname($path));
            if (! Str::isUuid($run)) {
                continue;
            }
            $metadata = $this->metadata($run);
            if ($metadata) {
                $rows[] = ['metadata' => $metadata, 'downloads' => $this->downloads($metadata)];
            }
        }
        usort($rows, fn ($a, $b) => strcmp($b['metadata']['started_at'] ?? '', $a['metadata']['started_at'] ?? ''));

        return array_slice($rows, 0, 100);
    }

    public function artifact(string $run, string $key): array
    {
        abort_unless(isset(self::ARTIFACTS[$key]), 404);
        $metadata = $this->metadata($run);
        abort_unless($metadata && isset($this->downloads($metadata)[$key]), 404);
        $path = rtrim(config('bcra.output_root'), '/\\').DIRECTORY_SEPARATOR.$run.DIRECTORY_SEPARATOR.self::ARTIFACTS[$key];
        abort_unless(is_file($path), 404);
        if (! hash_equals($metadata['artifacts'][$key]['sha256'] ?? '', hash_file('sha256', $path))) {
            throw new RuntimeException('BCRA artifact integrity check failed.');
        }

        return [$path, $key === 'zip' ? 'BCRA-Celesol-'.$metadata['period'].'-'.$run.'.zip' : basename($path)];
    }
}
