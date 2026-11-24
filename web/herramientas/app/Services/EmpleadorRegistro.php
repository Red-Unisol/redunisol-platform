<?php

namespace App\Services;

use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * Registro de uso de la consulta de empleador: quién consultó, cuándo, qué DNI/CUIL y si anduvo.
 * Un archivo por mes (consultas-AAAA-MM.ndjson) al que solo se le agregan líneas; no guarda la respuesta.
 */
class EmpleadorRegistro
{
    private const ZONA = 'America/Argentina/Buenos_Aires';

    public function anotar(string $usuario, string $identificador, bool $ok): void
    {
        $ahora = Carbon::now(self::ZONA);
        $dir = $this->dir();
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new RuntimeException('No se pudo crear la carpeta del registro.');
        }

        $linea = json_encode([
            'fecha' => $ahora->toIso8601String(),
            'usuario' => $usuario,
            'identificador' => $identificador,
            'estado' => $ok ? 'ok' : 'error',
        ], JSON_UNESCAPED_UNICODE)."\n";

        if (file_put_contents($dir.'/consultas-'.$ahora->format('Y-m').'.ndjson', $linea, FILE_APPEND | LOCK_EX) === false) {
            throw new RuntimeException('No se pudo escribir el registro.');
        }
    }

    /** Meses con consultas, del más nuevo al más viejo (AAAA-MM). */
    public function meses(): array
    {
        $meses = [];
        foreach (glob($this->dir().'/consultas-*.ndjson') ?: [] as $archivo) {
            if (preg_match('/consultas-(\d{4}-\d{2})\.ndjson$/', $archivo, $m)) {
                $meses[] = $m[1];
            }
        }
        rsort($meses);

        return $meses;
    }

    /** Consultas de un mes, de la más nueva a la más vieja. */
    public function consultas(string $mes): array
    {
        if (! preg_match('/^\d{4}-\d{2}$/', $mes)) {
            return [];
        }
        $archivo = $this->dir().'/consultas-'.$mes.'.ndjson';
        if (! is_file($archivo)) {
            return [];
        }

        $filas = [];
        foreach (file($archivo, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $linea) {
            $fila = json_decode($linea, true);
            if (is_array($fila)) {
                $filas[] = $fila;
            }
        }

        return array_reverse($filas);
    }

    public function mesActual(): string
    {
        return Carbon::now(self::ZONA)->format('Y-m');
    }

    private function dir(): string
    {
        return rtrim((string) config('tools.empleador_registro_path'), '/');
    }
}
