<?php

namespace App\Services;

use PDO;

class PublishedPadronesReader
{
    public function lookup(string $input): array
    {
        $document = PadronReader::document($input);
        if ($document === null) {
            PadronReader::fail('Ingresá un DNI de 7 u 8 dígitos o un CUIL de 11 dígitos.');
        }
        $path = config('padrones.directory').'/padrones.sqlite';
        abort_unless(is_file($path), 503, 'Los padrones todavía no están disponibles.');
        $db = new PDO('sqlite:'.$path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY,
        ]);
        $db->exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');
        $db->beginTransaction();
        try {
            $sources = $db->query('SELECT s.id,s.name,s.kind,s.active_version,v.period,v.created_at,v.state,v.mapping
                FROM sources s LEFT JOIN versions v ON v.id=s.active_version ORDER BY s.kind,s.name')->fetchAll();
            $results = [];
            foreach ($sources as $source) {
                $status = $source['active_version'] === null ? 'unpublished' : 'ready';
                $mapping = json_decode($source['mapping'] ?? 'null', true);
                $column = $mapping['document_column'] ?? null;
                $header = is_int($column) ? ($mapping['headers'][$column] ?? null) : null;
                if ($status === 'ready' && ($source['state'] !== 'published' || ! is_string($header) || PadronReader::document($header) !== null)) {
                    $status = 'needs_review';
                }
                $matches = [];
                if ($status === 'ready') {
                    $query = $db->prepare('SELECT row_number,data FROM records WHERE version_id=? AND document=? ORDER BY row_number LIMIT 501');
                    $query->execute([$source['active_version'], $document]);
                    $rows = $query->fetchAll();
                    if (count($rows) > 500) {
                        $status = 'needs_review';
                    } else {
                        foreach ($rows as $row) {
                            $data = json_decode($row['data'], true);
                            if (! is_array($data)) {
                                $status = 'needs_review';
                                $matches = [];
                                break;
                            }
                            $matches[] = ['row' => $row['row_number'], 'data' => $data];
                        }
                    }
                }
                $results[] = [
                    'id' => $source['id'], 'name' => $source['name'], 'kind' => $source['kind'],
                    'status' => $status, 'period' => $source['period'], 'loaded_at' => $source['created_at'], 'matches' => $matches,
                ];
            }
            $db->commit();

            return ['document' => $document, 'queried_at' => gmdate('c'), 'sources' => $results];
        } catch (\Throwable $exception) {
            $db->rollBack();
            throw $exception;
        }
    }
}
