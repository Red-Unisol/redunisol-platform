<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Consulta CUAD masiva: lanza y sigue el flow consulta_cuad_masivo de Kestra.
 *
 * Cada corrida vive en <output_root>/<corrida_id>/ (metadata.json, entrada.json,
 * resultado.ndjson), que escribe el flow y aca se lee de solo lectura. El estado
 * en vivo de cada cuenta esta en el KV cuad_masivo_estado_<corrida_id>; Reintentar
 * escribe cuad_masivo_reintentar_<corrida_id>_<alias>.
 */
class CuadMasivo
{
    public const TERMINALES = ['SUCCESS', 'FAILED', 'KILLED', 'CANCELLED', 'WARNING'];

    private const ID = '/^[A-Za-z0-9_-]{10,64}$/';

    public function configured(): bool
    {
        return config('cuad_masivo.kestra_url') !== '' && config('cuad_masivo.kestra_username') !== ''
            && config('cuad_masivo.kestra_password') !== '';
    }

    private function kestra()
    {
        if (! $this->configured()) {
            throw new RuntimeException('CUAD masivo is not configured.');
        }

        return Http::acceptJson()->withBasicAuth(config('cuad_masivo.kestra_username'), config('cuad_masivo.kestra_password'))
            ->connectTimeout(5)->timeout(30);
    }

    private function api(): string
    {
        return config('cuad_masivo.kestra_url').'/api/v1/'.rawurlencode(config('cuad_masivo.tenant'));
    }

    private function namespace(): string
    {
        return (string) config('cuad_masivo.namespace');
    }

    private function kvUrl(string $key): string
    {
        return $this->api().'/namespaces/'.rawurlencode($this->namespace()).'/kv/'.rawurlencode($key);
    }

    private function carpeta(string $corrida): string
    {
        abort_unless(preg_match(self::ID, $corrida), 404);

        return rtrim(config('cuad_masivo.output_root'), '/\\').DIRECTORY_SEPARATOR.$corrida;
    }

    /** Ejecuciones del flow que todavia no terminaron (en cola o corriendo). */
    public function activas(): array
    {
        $response = $this->kestra()->get($this->api().'/executions/search', [
            'filters' => [
                'namespace' => ['EQUALS' => $this->namespace()],
                'flowId' => ['EQUALS' => config('cuad_masivo.flow_id')],
                // El timeout de la tarea es de 12 h: una activa siempre empezo hace menos.
                'startDate' => ['GREATER_THAN_OR_EQUAL_TO' => now()->subHours(13)->toIso8601ZuluString()],
                'endDate' => ['LESS_THAN' => now()->addHour()->toIso8601ZuluString()],
            ],
            'sort' => 'state.startDate:desc', 'size' => 50,
        ]);
        if (! $response->successful() || ! is_array($response->json('results'))) {
            throw new RuntimeException('Could not list CUAD executions.');
        }

        return array_values(array_filter($response->json('results'), fn ($e) => ! in_array($e['state']['current'] ?? '', self::TERMINALES, true)));
    }

    private function sinCorridaActiva(): void
    {
        if ($this->activas()) {
            throw ValidationException::withMessages(['corrida' => 'Ya hay una corrida en curso o en cola. Esperá a que termine para lanzar otra.']);
        }
    }

    private function lanzar(array $campos, ?UploadedFile $archivo = null): string
    {
        $request = $this->kestra()->asMultipart();
        if ($archivo) {
            $request = $request->attach('archivo', $archivo->get(), $archivo->getClientOriginalName());
        }
        $response = $request->post($this->api().'/executions/'.rawurlencode($this->namespace()).'/'.config('cuad_masivo.flow_id'), $campos);
        $id = $response->json('id');
        if (! $response->successful() || ! is_string($id) || ! preg_match(self::ID, $id)) {
            // Un timeout pudo haber creado la ejecucion: nunca reintentar solo.
            throw new RuntimeException('Could not confirm CUAD execution.');
        }

        return $id;
    }

    /** Corrida nueva: con el Excel subido o con la linea superior fija. */
    public function iniciar(string $modo, ?UploadedFile $archivo, string $lanzadoPor): array
    {
        $this->sinCorridaActiva();
        $campos = ['lanzado_por' => $lanzadoPor];
        if ($modo === 'excel') {
            $campos['origen'] = 'Excel '.mb_substr($archivo->getClientOriginalName(), 0, 120);
            $id = $this->lanzar($campos, $archivo);
        } else {
            $campos['lineas'] = config('cuad_masivo.linea_superior.id');
            $id = $this->lanzar($campos);
        }

        // La primera ejecucion da el id de la corrida.
        return ['corrida_id' => $id, 'execution_id' => $id];
    }

    public function retomar(string $corrida, string $lanzadoPor): array
    {
        $metadata = $this->metadata($corrida);
        $estado = $metadata ? $this->estadoHistorial($metadata, $this->activas()) : null;
        if (! $metadata || ! is_file($this->carpeta($corrida).DIRECTORY_SEPARATOR.'entrada.json')
            || ! in_array($estado, ['interrumpida', 'incompleta'], true)) {
            throw ValidationException::withMessages(['corrida' => 'Esta corrida no se puede retomar.']);
        }
        $this->sinCorridaActiva();

        return ['corrida_id' => $corrida, 'execution_id' => $this->lanzar(['corrida_id' => $corrida, 'lanzado_por' => $lanzadoPor])];
    }

    public function reintentar(string $corrida, string $alias): array
    {
        abort_unless(preg_match('/^[A-Z]{1,8}$/', $alias), 404);
        $estado = $this->estado($corrida, null);
        $cuenta = collect($estado['cuentas'])->firstWhere('alias', $alias);
        if ($estado['estado'] !== 'corriendo' || ! $cuenta || $cuenta['estado'] !== 'caida') {
            throw ValidationException::withMessages(['cuenta' => "La cuenta {$alias} no está caída: no hace falta reintentar."]);
        }
        $response = $this->kestra()->withBody('1', 'text/plain')
            ->put($this->kvUrl("cuad_masivo_reintentar_{$corrida}_{$alias}"));
        if (! $response->successful()) {
            throw new RuntimeException('Could not request CUAD retry.');
        }

        return ['ok' => true];
    }

    private function kv(string $corrida): ?array
    {
        $response = $this->kestra()->get($this->kvUrl("cuad_masivo_estado_{$corrida}"));
        if (in_array($response->status(), [404, 410], true)) {
            return null;
        }
        if (! $response->successful()) {
            throw new RuntimeException('Could not read CUAD state.');
        }
        $valor = $response->json('value', $response->json());
        if (is_string($valor)) {
            $valor = json_decode($valor, true);
        }

        return is_array($valor) && ($valor['corrida_id'] ?? '') === $corrida ? $valor : null;
    }

    private function ejecucion(string $id, string $corrida): array
    {
        abort_unless(preg_match(self::ID, $id), 404);
        $response = $this->kestra()->get($this->api().'/executions/'.rawurlencode($id));
        abort_if($response->status() === 404, 404);
        if (! $response->successful()) {
            throw new RuntimeException('Could not read CUAD execution.');
        }
        $data = $response->json();
        $deLaCorrida = $id === $corrida || ($data['inputs']['corrida_id'] ?? '') === $corrida;
        abort_unless(($data['namespace'] ?? '') === $this->namespace()
            && ($data['flowId'] ?? '') === config('cuad_masivo.flow_id') && $deLaCorrida, 404);

        return $data;
    }

    /** Estado completo de una corrida: metadata + ejecucion de Kestra + cuentas del KV. */
    public function estado(string $corrida, ?string $execution): array
    {
        $metadata = $this->metadata($corrida);
        $execution ??= data_get(collect($metadata['ejecuciones'] ?? [])->last(), 'execution_id') ?? $corrida;
        $data = $this->ejecucion($execution, $corrida);
        $kestra = $data['state']['current'] ?? 'CREATED';
        $terminada = in_array($kestra, self::TERMINALES, true);
        $estadoMeta = $metadata['estado'] ?? null;
        $ultima = data_get(collect($metadata['ejecuciones'] ?? [])->last(), 'execution_id') ?? null;

        if (! $terminada) {
            // Una ejecucion nueva (o un retomar) todavia sin arrancar el script.
            $estado = $estadoMeta === 'corriendo' && $ultima === $execution ? 'corriendo' : 'en_cola';
        } elseif (! $metadata) {
            $estado = 'fallo';
            $metadata = ['motivo' => 'La ejecución terminó sin iniciar la corrida.'];
        } else {
            // Un corte duro (reinicio) deja "corriendo": la ejecucion ya termino.
            $estado = $estadoMeta === 'corriendo' ? 'interrumpida' : $estadoMeta;
        }

        $kv = $this->kv($corrida);
        $vigente = $kv && ($kv['execution_id'] ?? '') === $execution;
        $cuentas = [];
        foreach ($vigente ? ($kv['cuentas'] ?? []) : [] as $alias => $cuenta) {
            $cuentas[] = $this->cuenta((string) $alias, (array) $cuenta, $estado === 'corriendo');
        }
        $progreso = $vigente && $estado === 'corriendo'
            ? ['hechos' => (int) ($kv['hechos'] ?? 0), 'total' => (int) ($kv['total'] ?? 0)]
            : ['hechos' => (int) (($metadata['ok'] ?? 0) + ($metadata['sin_resultado'] ?? 0)), 'total' => (int) ($metadata['total'] ?? 0)];

        return ['corrida_id' => $corrida, 'execution_id' => $execution, 'execution_state' => $kestra,
            'estado' => $estado, 'metadata' => $this->resumen($corrida, $metadata), 'progreso' => $progreso,
            'cuentas' => $cuentas, 'activa' => ! $terminada];
    }

    private function cuenta(string $alias, array $c, bool $enCurso): array
    {
        $estado = (string) ($c['estado'] ?? 'esperando');
        $referencia = $c['hasta'] ?? $c['desde'] ?? null;
        $frenada = $enCurso && $referencia && ! in_array($estado, ['caida', 'terminada'], true)
            && Carbon::parse($referencia)->addSeconds(config('cuad_masivo.frenada_segundos'))->isPast();

        return ['alias' => $alias, 'estado' => $estado, 'consultados' => (int) ($c['consultados'] ?? 0),
            'detalle' => $c['detalle'] ?? null, 'desde' => $c['desde'] ?? null, 'hasta' => $c['hasta'] ?? null,
            'frenada' => $frenada, 'reintentable' => $enCurso && $estado === 'caida'];
    }

    public function metadata(string $corrida): ?array
    {
        $path = $this->carpeta($corrida).DIRECTORY_SEPARATOR.'metadata.json';
        if (! is_file($path)) {
            return null;
        }
        $data = json_decode((string) file_get_contents($path), true);
        if (! is_array($data) || ($data['corrida_id'] ?? '') !== $corrida) {
            throw new RuntimeException('Invalid CUAD run metadata.');
        }

        return $data;
    }

    /** Lo que se muestra de una corrida (sin los CUIL invalidos completos). */
    private function resumen(string $corrida, ?array $m): array
    {
        $m ??= [];
        $tieneResultado = is_file($this->carpeta($corrida).DIRECTORY_SEPARATOR.'resultado.ndjson');

        return ['corrida_id' => $corrida, 'creada_en' => $m['creada_en'] ?? null, 'actualizada_en' => $m['actualizada_en'] ?? null,
            'origen' => $m['origen'] ?? null, 'lanzado_por' => $m['lanzado_por'] ?? null,
            'total' => (int) ($m['total'] ?? 0), 'ok' => (int) ($m['ok'] ?? 0), 'sin_resultado' => (int) ($m['sin_resultado'] ?? 0),
            'error' => (int) ($m['error'] ?? 0), 'pendientes' => (int) ($m['pendientes'] ?? 0),
            'invalidos' => count($m['invalidos'] ?? []), 'duplicados' => (int) ($m['duplicados'] ?? 0),
            'advertencias' => array_values($m['advertencias'] ?? []), 'motivo' => $m['motivo'] ?? null,
            'ejecuciones' => count($m['ejecuciones'] ?? []),
            'descarga' => $tieneResultado ? route('cuad-masivo.download', ['corrida' => $corrida]) : null];
    }

    private function estadoHistorial(array $metadata, array $activas): string
    {
        $estado = (string) ($metadata['estado'] ?? 'fallo');
        if ($estado !== 'corriendo') {
            return $estado;
        }
        $ids = array_column($activas, 'id');
        $ultima = data_get(collect($metadata['ejecuciones'] ?? [])->last(), 'execution_id') ?? '';

        return in_array($ultima, $ids, true) ? 'corriendo' : 'interrumpida';
    }

    public function historial(): array
    {
        $activas = $this->activas();
        $rows = [];
        foreach (glob(rtrim(config('cuad_masivo.output_root'), '/\\').'/*/metadata.json') ?: [] as $path) {
            $corrida = basename(dirname($path));
            if (! preg_match(self::ID, $corrida)) {
                continue;
            }
            try {
                $metadata = $this->metadata($corrida);
            } catch (RuntimeException) {
                continue; // metadata a medio escribir o ajena: no rompe el historial
            }
            if (! $metadata) {
                continue;
            }
            $estado = $this->estadoHistorial($metadata, $activas);
            $rows[] = ['estado' => $estado, 'metadata' => $this->resumen($corrida, $metadata),
                'retomable' => in_array($estado, ['interrumpida', 'incompleta'], true)
                    && is_file($this->carpeta($corrida).DIRECTORY_SEPARATOR.'entrada.json')];
        }
        usort($rows, fn ($a, $b) => strcmp($b['metadata']['creada_en'] ?? '', $a['metadata']['creada_en'] ?? ''));
        // Corridas en cola que todavia no escribieron su carpeta.
        $conCarpeta = array_column(array_column($rows, 'metadata'), 'corrida_id');
        $enCola = [];
        foreach ($activas as $e) {
            $corrida = $e['inputs']['corrida_id'] ?? $e['id'] ?? '';
            if (preg_match(self::ID, $corrida) && ! in_array($corrida, $conCarpeta, true)) {
                $enCola[] = ['corrida_id' => $corrida, 'execution_id' => $e['id']];
            }
        }

        return ['corridas' => array_slice($rows, 0, 100), 'en_cola' => $enCola];
    }

    public function archivo(string $corrida): array
    {
        $path = $this->carpeta($corrida).DIRECTORY_SEPARATOR.'resultado.ndjson';
        abort_unless($this->metadata($corrida) && is_file($path), 404);
        $fecha = substr((string) ($this->metadata($corrida)['creada_en'] ?? ''), 0, 10) ?: 'corrida';

        return [$path, "cuad-masivo-{$fecha}-{$corrida}.ndjson"];
    }
}
