<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class AnalisisInbox
{
    private function evaluate(string $type, string $criteria, string $fields): array
    {
        $base = rtrim((string) config('analisis.core_url'), '/');
        if ($base === '') {
            throw new RuntimeException('Analysis source not configured.');
        }

        // Core negotiates application/json as a JSON string containing the JSON table.
        $request = Http::accept('text/plain')->connectTimeout(5)
            ->timeout(config('analisis.timeout_seconds'))
            ->withOptions(['verify' => config('analisis.verify_tls')]);
        if ($token = config('analisis.core_token')) {
            $request = $request->withToken($token);
        }
        $limit = (int) config('analisis.max_rows');
        $response = $request->post($base.'/api/Empresa/EvaluateList', [
            'tipo' => $type, 'cmd' => $criteria, 'campos' => $fields, 'max' => $limit + 1,
        ]);
        $rows = $response->json();
        if (is_string($rows)) {
            $rows = json_decode($rows, true);
        }
        if (! $response->successful() || ! is_array($rows) || ! array_is_list($rows) || count($rows) > $limit) {
            // Never publish a truncated or failed query as an empty/current inbox.
            throw new RuntimeException('Incomplete analysis source response.');
        }

        return $rows;
    }

    private function cached(string $name, int $seconds, callable $fetch): array
    {
        $cache = Cache::store(config('analisis.cache_store'));
        $key = 'analisis:v1:'.hash('sha256', json_encode([config('analisis'), $name]));
        if (($value = $cache->get($key)) !== null) {
            return $value;
        }

        // One shared query across analysts/tabs; failures are never cached.
        return $cache->lock($key.':lock', 30)->block(25, fn () => $cache->remember($key, $seconds, $fetch));
    }

    public function analysts(): array
    {
        return $this->cached('analysts', 300, function () {
            $rows = $this->evaluate('PreSolicitud.Module.EjecutivoSolicitud', 'True', 'Nombre;Usuario.UserName');
            $analysts = [];
            foreach ($rows as $row) {
                if (! is_array($row) || count($row) !== 2) {
                    throw new RuntimeException('Invalid analyst row.');
                }
                $username = trim((string) $row[1]);
                if ($username !== '') {
                    $analysts[mb_strtolower($username)] = ['username' => $username, 'name' => trim((string) $row[0]) ?: $username];
                }
            }
            ksort($analysts);

            return array_values($analysts);
        });
    }

    public function snapshot(string $username): array
    {
        $snapshot = $this->cached('snapshot', config('analisis.cache_seconds'), function () {
            $excluded = config('analisis.excluded_states');
            $ids = implode(',', array_map('intval', array_keys($excluded)));
            $criteria = "[Estado] Is Not Null AND NOT ([Estado.ID] In ($ids)) AND [EjecutivoSolicitud.Usuario.UserName] Is Not Null";
            $exitCriteria = implode(' OR ', array_map(
                fn ($label) => "StartsWith([Texto], '[".str_replace("'", "''", $label)."]')",
                array_values($excluded),
            ));
            $fields = 'Oid;Fecha;Estado.ID;Estado.Descripcion;NroDocumento;CUIT;NombreCompleto;EjecutivoSolicitud.Usuario.UserName'
                .";[Novedades][[Texto] Like 'Cambio Ejecutivo%'].Max(ID)"
                .";[Novedades][$exitCriteria].Max(ID)";
            $rows = $this->evaluate('PreSolicitud.Module.Solicitud', $criteria, $fields);
            $items = [];
            foreach ($rows as $row) {
                if (! is_array($row) || count($row) !== 10 || ! is_numeric($row[0]) || ! is_numeric($row[2])
                    || ($row[8] !== null && ! is_numeric($row[8])) || ($row[9] !== null && ! is_numeric($row[9]))) {
                    throw new RuntimeException('Invalid application row.');
                }
                // Defense against a source accidentally ignoring the state criteria.
                if (array_key_exists((int) $row[2], $excluded) || trim((string) $row[7]) === '') {
                    continue;
                }
                $items[] = [
                    'id' => (string) $row[0], 'date' => $row[1],
                    'state' => config('analisis.display_states')[(int) $row[2]] ?? (string) $row[3],
                    'dni' => (string) $row[4], 'cuit' => (string) $row[5], 'name' => (string) $row[6],
                    'analyst' => (string) $row[7],
                    // Also detects exit/reentry between polls or while this browser was closed.
                    'assignment' => (string) ($row[8] ?? 0).':'.(string) ($row[9] ?? 0),
                ];
            }
            usort($items, fn ($a, $b) => (int) $b['id'] <=> (int) $a['id']);

            return ['updated_at' => now()->toIso8601String(), 'items' => $items];
        });
        $snapshot['items'] = array_values(array_filter($snapshot['items'],
            fn ($item) => mb_strtolower($item['analyst']) === mb_strtolower($username)));

        return $snapshot;
    }
}
