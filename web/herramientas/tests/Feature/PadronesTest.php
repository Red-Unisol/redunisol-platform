<?php

namespace Tests\Feature;

use App\Services\PadronReader;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;
use Tests\TestCase;

class PadronesTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        $this->directory = sys_get_temp_dir().'/padrones-test-'.bin2hex(random_bytes(8));
        config()->set(['padrones.directory' => $this->directory, 'app.key' => 'base64:'.base64_encode(str_repeat('p', 32)), 'tools.enabled' => true, 'analisis.password_hash' => password_hash('test-password', PASSWORD_BCRYPT, ['cost' => 4])]);
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        gc_collect_cycles();
        (new Filesystem)->deleteDirectory($this->directory);
    }

    private function login(): void
    {
        $this->postJson('/padrones/login', ['password' => 'test-password'])->assertOk();
    }

    private function upload(string $csv, string $source = 'educacion'): string
    {
        return $this->post('/api/padrones/sources/'.$source.'/versions', ['period' => '2026-08', 'file' => UploadedFile::fake()->createWithContent('padron.csv', $csv)], ['Accept' => 'application/json'])->assertCreated()->json('version');
    }

    private function prepare(string $id, string $source = 'educacion', array $mapping = [])
    {
        return $this->postJson('/api/padrones/sources/'.$source.'/versions/'.$id.'/prepare', $mapping ?: ['sheet' => 'CSV', 'header_row' => 1, 'document_column' => 0, 'columns' => [0, 1]]);
    }

    private function activate(string $id, ?string $expected = null, bool $acknowledged = true, string $source = 'educacion')
    {
        return $this->postJson('/api/padrones/sources/'.$source.'/versions/'.$id.'/activate', ['expected_version' => $expected, 'acknowledged' => $acknowledged]);
    }

    public function test_all_data_and_writes_require_analysis_access(): void
    {
        $this->get('/padrones')->assertOk()->assertSee('"authenticated":false', false);
        $this->getJson('/api/padrones/sources')->assertUnauthorized();
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertUnauthorized();
        $this->postJson('/api/padrones/sources', [])->assertUnauthorized();
        $this->postJson('/api/padrones/sources/educacion/versions', [])->assertUnauthorized();
        $this->postJson('/api/padrones/sources/educacion/versions/test/activate', [])->assertUnauthorized();
        $this->login();
        $this->getJson('/api/padrones/sources')->assertOk()->assertJsonCount(5, 'sources')->assertHeader('Cache-Control', 'no-store, private');
        config()->set('analisis.password_hash', password_hash('rotated', PASSWORD_BCRYPT));
        $this->getJson('/api/padrones/sources')->assertUnauthorized();
    }

    public function test_drafts_do_not_affect_lookup_and_publication_preserves_all_matches(): void
    {
        $this->login();
        $id = $this->upload("CUIL,nombres\n20123456786,Persona A\n12345678,Persona A segundo cargo\nINVALIDO,Excluir\n");
        $this->activate($id)->assertStatus(409);
        $this->prepare($id)->assertOk()->assertJsonPath('summary.valid', 2)->assertJsonPath('summary.invalid', 1)->assertJsonPath('summary.multiple_documents', 1);
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertJsonCount(0, 'sources');
        $this->activate($id, null, false)->assertUnprocessable();
        $this->activate($id)->assertOk();
        $this->postJson('/api/padrones/lookup', ['document' => '20-12345678-6'])->assertOk()->assertJsonPath('document', '12345678')->assertJsonCount(2, 'sources.0.matches')->assertJsonPath('sources.0.period', '2026-08');
        $this->prepare($id)->assertStatus(409);
    }

    public function test_failed_import_keeps_previous_version_and_restore_is_atomic(): void
    {
        $this->login();
        $first = $this->upload("CUIL,nombres\n12345678,Anterior\n");
        $this->prepare($first)->assertOk();
        $this->activate($first)->assertOk();
        $bad = $this->upload("CUIL,nombres\nINVALIDO,Error\n");
        $this->prepare($bad)->assertUnprocessable();
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertJsonPath('sources.0.matches.0.data.nombres', 'Anterior');
        $second = $this->upload("CUIL,nombres\n87654321,Nueva\n");
        $this->prepare($second)->assertOk()->assertJsonPath('summary.added_documents', 1)->assertJsonPath('summary.removed_documents', 1);
        $this->activate($second, $first)->assertOk();
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertJsonCount(0, 'sources.0.matches');
        $this->activate($first, $second)->assertOk();
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertJsonPath('sources.0.matches.0.data.nombres', 'Anterior');
        $this->getJson('/api/padrones/sources')->assertJsonCount(5, 'sources');
    }

    public function test_concurrent_publication_requires_new_preview(): void
    {
        $this->login();
        $a = $this->upload("CUIL,nombres\n12345678,A\n");
        $b = $this->upload("CUIL,nombres\n12345678,B\n");
        $this->prepare($a)->assertOk();
        $this->prepare($b)->assertOk();
        $this->activate($a)->assertOk();
        $this->activate($b)->assertStatus(409);
        $this->activate($b, $a)->assertStatus(409);
        $this->prepare($b)->assertOk();
        $this->activate($b, $a)->assertOk();
    }

    public function test_new_source_and_bajas_are_independent_and_cross_source_ids_rejected(): void
    {
        $this->login();
        $source = $this->postJson('/api/padrones/sources', ['name' => 'Nueva fuente', 'description' => 'Prueba', 'kind' => 'bajas'])->assertCreated()->json('id');
        $id = $this->upload("Documento,Causa\n12345678,Baja informada\n", $source);
        $this->prepare($id, $source)->assertOk();
        $this->activate($id, null, true, $source)->assertOk();
        $this->activate($id)->assertNotFound();
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertJsonPath('sources.0.kind', 'bajas')->assertJsonPath('sources.0.matches.0.data.Causa', 'Baja informada');
    }

    public function test_xlsx_blank_preamble_dates_and_sheet_selection(): void
    {
        $this->login();
        mkdir($this->directory, 0700, true);
        $path = $this->directory.'/fixture.xlsx';
        $writer = new Writer;
        $writer->openToFile($path);
        $writer->getCurrentSheet()->setName('Personal');
        $writer->addRow(Row::fromValues(['']));
        $writer->addRow(Row::fromValues(['Documento', 'Nombre', 'Fecha']));
        $writer->addRow(Row::fromValuesWithStyles([12345678, 'Ejemplo', new \DateTimeImmutable('2026-08-01')], null, [2 => (new Style)->setFormat('yyyy-mm-dd')]));
        $writer->addNewSheetAndMakeItCurrent()->setName('No importar');
        $writer->addRow(Row::fromValues(['Documento', 'Nombre']));
        $writer->addRow(Row::fromValues([87654321, 'Otro']));
        $writer->close();
        $id = $this->post('/api/padrones/sources/educacion/versions', ['period' => '2026-08', 'file' => new UploadedFile($path, 'ejemplo.xlsx', null, null, true)], ['Accept' => 'application/json'])->assertCreated()->assertJsonCount(2, 'sheets')->json('version');
        $this->prepare($id, 'educacion', ['sheet' => 'Personal', 'header_row' => 2, 'document_column' => 0, 'columns' => [0, 1, 2]])->assertOk()->assertJsonPath('summary.valid', 1)->assertJsonPath('summary.sample.0.data.Fecha', '2026-08-01');
        $this->activate($id)->assertOk();
        $this->postJson('/api/padrones/lookup', ['document' => '87654321'])->assertJsonCount(0, 'sources.0.matches');
    }

    public function test_structure_change_needs_acknowledgement_and_semicolon_csv_is_supported(): void
    {
        $this->login();
        $id = $this->upload("DNI;Apellido\n12.345.678;Ejemplo\n");
        $this->prepare($id)->assertOk()->assertJsonPath('summary.structure_changed', true);
        $this->activate($id, null, false)->assertUnprocessable();
        $this->activate($id)->assertOk();
        $this->postJson('/api/padrones/lookup', ['document' => '12345678'])->assertJsonPath('sources.0.matches.0.data.Apellido', 'Ejemplo');
    }

    public function test_rejects_invalid_identifiers_formats_mapping_and_period(): void
    {
        $this->login();
        foreach (['123', '1.2345678E7', 'documento12345678', '=12345678', '00000000'] as $input) {
            $this->assertNull(PadronReader::document($input));
            $this->postJson('/api/padrones/lookup', ['document' => $input])->assertUnprocessable();
        }
        $this->post('/api/padrones/sources/educacion/versions', ['period' => '2026-13', 'file' => UploadedFile::fake()->createWithContent('x.csv', 'x')], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->post('/api/padrones/sources/educacion/versions', ['period' => '2026-08', 'file' => UploadedFile::fake()->createWithContent('x.php', '<?php')], ['Accept' => 'application/json'])->assertUnprocessable();
        $id = $this->upload("CUIL,nombres\n12345678,A\n");
        $this->prepare($id, 'educacion', ['sheet' => 'CSV', 'header_row' => 1, 'document_column' => 20, 'columns' => [0, 1]])->assertUnprocessable();
        $this->prepare($id, 'educacion', ['sheet' => 'No existe', 'header_row' => 1, 'document_column' => 0, 'columns' => [0, 1]])->assertUnprocessable();
    }

    public function test_reader_limits_and_failed_prepare_roll_back_records(): void
    {
        $this->login();
        $id = $this->upload("CUIL,nombres\n12345678,A\n87654321,B\n");
        config()->set('padrones.max_rows', 1);
        $this->prepare($id)->assertUnprocessable();
        $this->activate($id)->assertStatus(409);
        config()->set('padrones.max_rows', 100000);
        $this->prepare($id)->assertOk()->assertJsonPath('summary.valid', 2);
    }
}
