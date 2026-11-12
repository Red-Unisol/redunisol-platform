<?php

namespace Tests\Feature;

use Illuminate\Filesystem\Filesystem;
use PDO;
use Tests\TestCase;

class PadronesServiceTest extends TestCase
{
    private string $directory;

    private string $token = 'local-test-token-with-at-least-32-characters';

    protected function setUp(): void
    {
        parent::setUp();
        $this->directory = sys_get_temp_dir().'/padrones-service-test-'.bin2hex(random_bytes(8));
        config()->set(['padrones.directory' => $this->directory, 'padrones.service_token' => $this->token,
            'tools.enabled' => true, 'app.key' => 'base64:'.base64_encode(str_repeat('p', 32))]);
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        gc_collect_cycles();
        (new Filesystem)->deleteDirectory($this->directory);
    }

    private function fixture(): void
    {
        mkdir($this->directory, 0700, true);
        $db = new PDO('sqlite:'.$this->directory.'/padrones.sqlite');
        $db->exec('CREATE TABLE sources(id TEXT,name TEXT,kind TEXT,active_version TEXT);
            CREATE TABLE versions(id TEXT,period TEXT,created_at TEXT,state TEXT,mapping TEXT);
            CREATE TABLE records(version_id TEXT,row_number INTEGER,document TEXT,data TEXT);
            CREATE INDEX records_document ON records(version_id,document);');
        $source = $db->prepare('INSERT INTO sources VALUES(?,?,?,?)');
        $source->execute(['educacion', 'Educación', 'padron', 'v1']);
        $source->execute(['bajas', 'Bajas', 'bajas', null]);
        $source->execute(['administracion', 'Administración', 'padron', 'bad-header']);
        $version = $db->prepare('INSERT INTO versions VALUES(?,?,?,?,?)');
        $version->execute(['v1', '2026-11', '2026-11-11T12:00:00Z', 'published', json_encode(['document_column' => 0, 'headers' => ['CUIL', 'Nombre']])]);
        $version->execute(['bad-header', '2026-11', '2026-11-11T12:00:00Z', 'published', json_encode(['document_column' => 0, 'headers' => ['20123456783', 'Persona ficticia']])]);
        $record = $db->prepare('INSERT INTO records VALUES(?,?,?,?)');
        $record->execute(['v1', 2, '12345678', json_encode(['CUIL' => '20123456783', 'Nombre' => 'Cargo uno'])]);
        $record->execute(['v1', 3, '12345678', json_encode(['CUIL' => '20123456783', 'Nombre' => 'Cargo dos'])]);
        $record->execute(['v1', 4, '87654321', json_encode(['CUIL' => '20876543213', 'Nombre' => 'Otra persona'])]);
        $record->execute(['bad-header', 3, '12345678', json_encode(['20123456783' => 'valor privado que no debe salir'])]);
    }

    public function test_authentication_precedes_reads_and_never_grants_administration(): void
    {
        $this->postJson('/api/internal/padrones/lookup', ['document' => '12345678'])->assertUnauthorized();
        $this->withToken('wrong')->postJson('/api/internal/padrones/lookup', ['document' => '12345678'])->assertUnauthorized();
        $this->withToken($this->token)->postJson('/api/padrones/sources', ['name' => 'No permitido', 'kind' => 'padron'])->assertUnauthorized();
        $this->assertDirectoryDoesNotExist($this->directory);
    }

    public function test_unconfigured_missing_and_corrupt_databases_fail_without_creating_a_database(): void
    {
        config()->set('padrones.service_token', '');
        $this->withToken($this->token)->postJson('/api/internal/padrones/lookup', ['document' => '12345678'])->assertStatus(503);
        config()->set('padrones.service_token', $this->token);
        $this->withToken($this->token)->postJson('/api/internal/padrones/lookup', ['document' => '12345678'])->assertStatus(503);
        $this->assertDirectoryDoesNotExist($this->directory);
        mkdir($this->directory, 0700, true);
        file_put_contents($this->directory.'/padrones.sqlite', 'not a database');
        $this->withToken($this->token)->postJson('/api/internal/padrones/lookup', ['document' => '12345678'])->assertStatus(503);
    }

    public function test_lookup_preserves_all_cargos_periods_and_source_states_without_writing(): void
    {
        $this->fixture();
        $before = hash_file('sha256', $this->directory.'/padrones.sqlite');
        $response = $this->withToken($this->token)->postJson('/api/internal/padrones/lookup', ['document' => '20-12345678-3'])->assertOk();
        $response->assertJsonPath('document', '12345678')->assertJsonCount(3, 'sources');
        $byId = collect($response->json('sources'))->keyBy('id');
        $this->assertSame('unpublished', $byId['bajas']['status']);
        $this->assertSame('needs_review', $byId['administracion']['status']);
        $this->assertSame([], $byId['administracion']['matches']);
        $this->assertSame('ready', $byId['educacion']['status']);
        $this->assertSame('2026-11', $byId['educacion']['period']);
        $this->assertCount(2, $byId['educacion']['matches']);
        $this->assertStringNotContainsString('valor privado', $response->getContent());
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertSame($before, hash_file('sha256', $this->directory.'/padrones.sqlite'));
        $other = $this->withToken($this->token)->postJson('/api/internal/padrones/lookup', ['document' => '11111111'])->assertOk();
        foreach ($other->json('sources') as $source) {
            $this->assertSame([], $source['matches']);
        }
    }

    public function test_invalid_identifiers_do_not_open_the_database(): void
    {
        foreach (['123', '1e8', 'apellido', '../padrones.sqlite'] as $document) {
            $this->withToken($this->token)->postJson('/api/internal/padrones/lookup', ['document' => $document])->assertUnprocessable();
        }
        $this->assertDirectoryDoesNotExist($this->directory);
    }
}
