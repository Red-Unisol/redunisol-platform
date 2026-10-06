<?php

namespace App\Services;

use DateTimeInterface;
use Generator;
use Illuminate\Validation\ValidationException;
use OpenSpout\Common\Exception\OpenSpoutException;
use OpenSpout\Reader\XLSX\Options;
use OpenSpout\Reader\XLSX\Reader;
use ZipArchive;

class PadronReader
{
    public static function fail(string $message): never
    {
        throw ValidationException::withMessages(['file' => $message]);
    }

    public static function document(mixed $value): ?string
    {
        $text = trim((string) $value);
        if (! preg_match('/^[0-9 .-]+$/D', $text)) {
            return null;
        }
        $digits = preg_replace('/\D/', '', $text);
        if (strlen($digits) === 11) {
            $digits = substr($digits, 2, 8);
        } elseif (! in_array(strlen($digits), [7, 8], true)) {
            return null;
        }
        $digits = ltrim($digits, '0');

        return strlen($digits) >= 6 ? $digits : null;
    }

    public function inspect(string $path): array
    {
        $sheets = [];
        foreach ($this->rows($path) as [$sheet, $number, $values]) {
            $sheets[$sheet] ??= ['name' => $sheet, 'rows' => []];
            if ($number <= 10) {
                $sheets[$sheet]['rows'][] = ['number' => $number, 'values' => $values];
            }
        }

        return array_values($sheets);
    }

    /** Reads values only. No formulas, external links or macros are executed. */
    public function rows(string $path): Generator
    {
        $total = 0;
        if (str_ends_with($path, '.csv')) {
            $handle = fopen($path, 'rb');
            try {
                $sample = fgets($handle) ?: '';
                $delimiter = ',';
                $largest = 0;
                foreach ([',', ';', "\t"] as $candidate) {
                    $count = count(str_getcsv($sample, $candidate, '"', ''));
                    if ($count > $largest) {
                        $largest = $count;
                        $delimiter = $candidate;
                    }
                }
                rewind($handle);
                while (($row = fgetcsv($handle, null, $delimiter, '"', '')) !== false) {
                    $total++;
                    if ($total > config('padrones.max_rows') + 100) {
                        self::fail('El archivo supera el límite de filas.');
                    }
                    $row = array_map(function ($cell) {
                        $cell = (string) $cell;
                        if (! mb_check_encoding($cell, 'UTF-8')) {
                            $cell = mb_convert_encoding($cell, 'UTF-8', 'Windows-1252');
                        }

                        return preg_replace('/^\x{FEFF}/u', '', $cell);
                    }, $row);
                    yield ['CSV', $total, $this->values($row)];
                }
            } finally {
                fclose($handle);
            }

            return;
        }

        $zip = new ZipArchive;
        if ($zip->open($path) !== true) {
            self::fail('No se pudo abrir el Excel. Subí un archivo XLSX válido.');
        }
        try {
            $bytes = 0;
            if ($zip->numFiles > 2000 || $zip->locateName('xl/workbook.xml') === false) {
                self::fail('El archivo no es un XLSX compatible.');
            }
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->statIndex($i);
                $bytes += $entry['size'];
                if ($bytes > 200 * 1024 * 1024 || str_contains($entry['name'], '..') || str_contains(strtolower($entry['name']), 'vbaproject')) {
                    self::fail('El Excel excede el tamaño permitido o contiene macros.');
                }
            }
        } finally {
            $zip->close();
        }
        $options = new Options;
        $options->SHOULD_PRESERVE_EMPTY_ROWS = true;
        $reader = new Reader($options);
        try {
            $reader->open($path);
            $sheetCount = 0;
            foreach ($reader->getSheetIterator() as $sheet) {
                if (++$sheetCount > 20) {
                    self::fail('El Excel supera las 20 hojas permitidas.');
                }
                foreach ($sheet->getRowIterator() as $number => $row) {
                    if (++$total > config('padrones.max_rows') + 100) {
                        self::fail('El archivo supera el límite de filas.');
                    }
                    yield [$sheet->getName(), $number, $this->values($row->toArray())];
                }
            }
        } catch (OpenSpoutException $exception) {
            self::fail('No se pudo leer el Excel. Guardá una copia nueva como XLSX y volvé a subirla.');
        } finally {
            $reader->close();
        }
    }

    private function values(array $row): array
    {
        if (count($row) > config('padrones.max_columns')) {
            self::fail('El archivo supera las 60 columnas permitidas.');
        }

        return array_map(function ($value) {
            $text = $value instanceof DateTimeInterface ? $value->format('Y-m-d') : trim((string) $value);
            if (mb_strlen($text) > 2000) {
                self::fail('Una celda supera los 2000 caracteres permitidos.');
            }

            return $text;
        }, $row);
    }
}
