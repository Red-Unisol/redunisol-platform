<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use PDO;
use Throwable;

class Padrones
{
    private PDO $db;

    public function __construct(private PadronReader $reader)
    {
        $directory = config('padrones.directory');
        if (! is_dir($directory)) {
            mkdir($directory, 0700, true);
        }
        $this->db = new PDO('sqlite:'.$directory.'/padrones.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $this->db->exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
        if ((int) $this->db->query('PRAGMA user_version')->fetchColumn() >= 1) {
            return;
        }
        $this->db->exec('CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, kind TEXT NOT NULL, active_version TEXT, mapping TEXT);
            CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), filename TEXT NOT NULL, extension TEXT NOT NULL, period TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL, mapping TEXT, summary TEXT, baseline TEXT, sha256 TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS records (version_id TEXT NOT NULL REFERENCES versions(id), row_number INTEGER NOT NULL, document TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(version_id,row_number));
            CREATE INDEX IF NOT EXISTS records_document ON records(version_id,document);
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, version_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL);');
        $this->transaction(function () {
            foreach (config('padrones.sources', []) as [$name, $description, $kind, $headers, $row]) {
                $document = array_search('CUIL', $headers, true);
                $document = $document === false ? 0 : $document;
                $mapping = ['sheet' => 'Hoja1', 'header_row' => $row, 'headers' => $headers, 'document_column' => $document, 'columns' => array_values(array_filter(array_keys($headers), fn ($i) => $headers[$i] !== ''))];
                $this->query('INSERT OR IGNORE INTO sources(id,name,description,kind,mapping) VALUES(?,?,?,?,?)', [Str::slug($name), $name, $description, $kind, json_encode($mapping)]);
            }
            $this->db->exec('PRAGMA user_version=1');
        });
    }

    private function query(string $sql, array $args = []): \PDOStatement
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($args);

        return $statement;
    }

    private function transaction(callable $operation): mixed
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $result = $operation();
            $this->db->exec('COMMIT');

            return $result;
        } catch (Throwable $exception) {
            $this->db->exec('ROLLBACK');
            throw $exception;
        }
    }

    public function sources(): array
    {
        return array_map(function ($source) {
            $source['mapping'] = json_decode($source['mapping'] ?? 'null', true);
            $source['versions'] = array_map(fn ($v) => $this->decodeVersion($v), $this->query('SELECT * FROM versions WHERE source_id=? ORDER BY created_at DESC,id DESC', [$source['id']])->fetchAll());

            return $source;
        }, $this->query('SELECT * FROM sources ORDER BY name')->fetchAll());
    }

    public function createSource(array $data): string
    {
        if ($this->query('SELECT id FROM sources WHERE name=?', [$data['name']])->fetch()) {
            PadronReader::fail('Ya existe una fuente con ese nombre.');
        }
        $id = (string) Str::uuid();
        $this->query('INSERT INTO sources(id,name,description,kind) VALUES(?,?,?,?)', [$id, $data['name'], $data['description'] ?? '', $data['kind']]);

        return $id;
    }

    private function source(string $id): array
    {
        $source = $this->query('SELECT * FROM sources WHERE id=?', [$id])->fetch();
        abort_unless($source, 404);

        return $source;
    }

    private function version(string $source, string $id): array
    {
        $version = $this->query('SELECT * FROM versions WHERE source_id=? AND id=?', [$source, $id])->fetch();
        abort_unless($version, 404);

        return $version;
    }

    private function decodeVersion(array $version): array
    {
        $version['mapping'] = json_decode($version['mapping'] ?? 'null', true);
        $version['summary'] = json_decode($version['summary'] ?? 'null', true);

        return $version;
    }

    private function path(array $version): string
    {
        return config('padrones.directory').'/'.$version['id'].'.'.$version['extension'];
    }

    public function upload(string $sourceId, UploadedFile $file, string $period): array
    {
        $source = $this->source($sourceId);
        $extension = strtolower($file->getClientOriginalExtension());
        if (! in_array($extension, ['xlsx', 'csv'], true)) {
            PadronReader::fail('Usá Excel XLSX o CSV. Para XLS antiguo, guardá una copia como XLSX.');
        }
        $id = (string) Str::uuid();
        $version = ['id' => $id, 'extension' => $extension];
        $file->move(config('padrones.directory'), $id.'.'.$extension);
        try {
            $sheets = $this->reader->inspect($this->path($version));
            $this->query('INSERT INTO versions(id,source_id,filename,extension,period,created_at,state,baseline,sha256) VALUES(?,?,?,?,?,?,?,?,?)', [$id, $sourceId, basename($file->getClientOriginalName()), $extension, $period, gmdate('c'), 'uploaded', $source['active_version'], hash_file('sha256', $this->path($version))]);

            return ['version' => $id, 'sheets' => $sheets, 'mapping' => json_decode($source['mapping'] ?? 'null', true)];
        } catch (Throwable $exception) {
            unlink($this->path($version));
            throw $exception;
        }
    }

    public function inspect(string $source, string $id): array
    {
        $version = $this->version($source, $id);

        return ['version' => $id, 'sheets' => $this->reader->inspect($this->path($version)), 'mapping' => json_decode($version['mapping'] ?? $this->source($source)['mapping'] ?? 'null', true)];
    }

    public function prepare(string $sourceId, string $id, array $mapping): array
    {
        return $this->transaction(function () use ($sourceId, $id, $mapping) {
            $source = $this->source($sourceId);
            $version = $this->version($sourceId, $id);
            abort_unless(in_array($version['state'], ['uploaded', 'ready'], true), 409, 'Una versión publicada no se puede modificar.');
            $this->query('DELETE FROM records WHERE version_id=?', [$id]);
            $headers = null;
            $valid = $invalid = $blank = 0;
            $issues = $sample = [];
            $seen = [];
            foreach ($this->reader->rows($this->path($version)) as [$sheet, $number, $values]) {
                if ($sheet !== $mapping['sheet'] || $number < $mapping['header_row']) {
                    continue;
                }
                if ($number === $mapping['header_row']) {
                    $headers = $values;
                    foreach (array_unique([...$mapping['columns'], $mapping['document_column']]) as $index) {
                        if (! isset($headers[$index]) || $headers[$index] === '') {
                            PadronReader::fail('Elegí columnas con encabezados completos.');
                        }
                    }
                    $selectedHeaders = array_map(fn ($i) => $headers[$i], $mapping['columns']);
                    if (count(array_unique($selectedHeaders)) !== count($selectedHeaders)) {
                        PadronReader::fail('Las columnas seleccionadas tienen nombres repetidos.');
                    }

                    continue;
                }
                if (count(array_filter($values, fn ($x) => $x !== '')) === 0) {
                    $blank++;

                    continue;
                }
                if ($valid + $invalid >= config('padrones.max_rows')) {
                    PadronReader::fail('El archivo supera el límite de registros.');
                }
                $document = PadronReader::document($values[$mapping['document_column']] ?? '');
                if ($document === null) {
                    $invalid++;
                    if (count($issues) < 20) {
                        $issues[] = ['row' => $number, 'message' => 'DNI/CUIL vacío o con formato no reconocido.'];
                    }

                    continue;
                }
                $data = [];
                foreach ($mapping['columns'] as $index) {
                    $data[$headers[$index]] = $values[$index] ?? '';
                }
                $this->query('INSERT INTO records(version_id,row_number,document,data) VALUES(?,?,?,?)', [$id, $number, $document, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
                $seen[$document] = ($seen[$document] ?? 0) + 1;
                if (count($sample) < 5) {
                    $sample[] = ['row' => $number, 'data' => $data];
                }
                $valid++;
            }
            if ($headers === null || $valid === 0) {
                PadronReader::fail('No hay registros válidos. Revisá la hoja, los encabezados y la columna DNI/CUIL.');
            }
            $mapping['headers'] = $headers;
            $oldMapping = json_decode($source['mapping'] ?? 'null', true);
            $previous = $source['active_version'];
            $oldCount = $previous ? (int) $this->query('SELECT COUNT(*) FROM records WHERE version_id=?', [$previous])->fetchColumn() : 0;
            $added = (int) $this->query('SELECT COUNT(DISTINCT n.document) FROM records n WHERE n.version_id=? AND NOT EXISTS(SELECT 1 FROM records o WHERE o.version_id=? AND o.document=n.document)', [$id, $previous])->fetchColumn();
            $removed = (int) $this->query('SELECT COUNT(DISTINCT o.document) FROM records o WHERE o.version_id=? AND NOT EXISTS(SELECT 1 FROM records n WHERE n.version_id=? AND n.document=o.document)', [$previous, $id])->fetchColumn();
            $summary = ['valid' => $valid, 'invalid' => $invalid, 'blank' => $blank, 'unique_documents' => count($seen), 'multiple_documents' => count(array_filter($seen, fn ($n) => $n > 1)), 'issues' => $issues, 'sample' => $sample, 'previous_records' => $oldCount, 'added_documents' => $added, 'removed_documents' => $removed, 'structure_changed' => $oldMapping !== null && ($oldMapping['headers'] !== $headers || $oldMapping['document_column'] !== $mapping['document_column'] || $oldMapping['columns'] !== $mapping['columns'])];
            $this->query('UPDATE versions SET state=?,mapping=?,summary=?,baseline=? WHERE id=?', ['ready', json_encode($mapping), json_encode($summary), $previous, $id]);

            return ['version' => $id, 'summary' => $summary];
        });
    }

    public function activate(string $sourceId, string $id, ?string $expected, bool $acknowledged): void
    {
        $this->transaction(function () use ($sourceId, $id, $expected, $acknowledged) {
            $source = $this->source($sourceId);
            $version = $this->decodeVersion($this->version($sourceId, $id));
            abort_unless($source['active_version'] === $expected, 409, 'La fuente cambió. Recargá antes de publicar.');
            abort_unless(in_array($version['state'], ['ready', 'published'], true), 409, 'Validá el archivo antes de publicar.');
            if ($version['state'] === 'ready') {
                abort_unless($version['baseline'] === $expected, 409, 'La versión vigente cambió. Volvé a validar el archivo.');
            }
            if (($version['summary']['invalid'] > 0 || $version['summary']['structure_changed']) && ! $acknowledged) {
                PadronReader::fail('Confirmá la revisión de las advertencias antes de publicar.');
            }
            $action = $version['state'] === 'published' ? 'restore' : 'publish';
            $this->query('UPDATE sources SET active_version=?,mapping=? WHERE id=?', [$id, json_encode($version['mapping']), $sourceId]);
            $this->query('UPDATE versions SET state=? WHERE id=?', ['published', $id]);
            $this->query('INSERT INTO audit(source_id,version_id,action,created_at,actor) VALUES(?,?,?,?,?)', [$sourceId, $id, $action, gmdate('c'), 'Equipo de Análisis (acceso compartido)']);
        });
    }

    public function lookup(string $input): array
    {
        $document = PadronReader::document($input);
        if ($document === null) {
            PadronReader::fail('Ingresá un DNI de 7 u 8 dígitos o un CUIL de 11 dígitos.');
        }
        // One read transaction prevents mixing versions if a publication happens mid-query.
        $this->db->beginTransaction();
        try {
            $sources = $this->query('SELECT s.*,v.period,v.created_at FROM sources s JOIN versions v ON v.id=s.active_version ORDER BY s.kind,s.name')->fetchAll();
            $results = [];
            foreach ($sources as $source) {
                $matches = $this->query('SELECT row_number,data FROM records WHERE version_id=? AND document=? ORDER BY row_number', [$source['active_version'], $document])->fetchAll();
                $results[] = ['id' => $source['id'], 'name' => $source['name'], 'kind' => $source['kind'], 'period' => $source['period'], 'loaded_at' => $source['created_at'], 'matches' => array_map(fn ($r) => ['row' => $r['row_number'], 'data' => json_decode($r['data'], true)], $matches)];
            }
            $this->db->commit();

            return ['document' => $document, 'sources' => $results];
        } catch (Throwable $exception) {
            $this->db->rollBack();
            throw $exception;
        }
    }
}
