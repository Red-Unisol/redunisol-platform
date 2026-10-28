<?php

namespace App\Console\Commands;

use App\Services\JourneyLedger;
use Illuminate\Console\Command;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class JourneyStorage extends Command
{
    protected $signature = 'journey:storage {action=status : status, initialize or import-attribution}';

    protected $description = 'Inspect the dedicated volume or copy legacy attribution without overwriting volume records';

    public function handle(JourneyLedger $ledger): int
    {
        $directory = $ledger->directory();
        $action = $this->argument('action');
        if ($action === 'status') {
            $free = disk_free_space($directory);
            $this->line(json_encode(['mounted' => true, 'free_bytes' => $free,
                'reserve_bytes' => config('journey.min_free_bytes'), 'files' => count(glob($directory.'/events-*.jsonl') ?: []),
                'attribution_connection' => config('attribution.connection') ?: config('database.default')]));

            return $free < config('journey.min_free_bytes') * 2 ? self::FAILURE : self::SUCCESS;
        }
        if (! in_array($action, ['initialize', 'import-attribution'], true)) {
            return self::FAILURE;
        }
        $path = $directory.'/attribution.sqlite';
        if (! is_file($path)) {
            touch($path);
            chmod($path, 0660);
        }
        $schema = Schema::connection('journey');
        if (! $schema->hasTable('attribution_journeys')) {
            $schema->create('attribution_journeys', function (Blueprint $table) {
                $table->string('id', 24)->primary();
                $table->text('snapshot');
                $table->string('recipient_hash', 64)->nullable();
                $table->string('subject_id')->nullable();
                $table->timestamp('bound_at')->nullable();
                $table->timestamp('expires_at')->index();
                $table->timestamps();
            });
        }
        if ($action === 'import-attribution') {
            // Business DB remains the source for this one-time migration. Never delete it here.
            $count = 0;
            DB::connection()->table('attribution_journeys')->orderBy('id')->chunkById(500, function ($rows) use (&$count) {
                DB::connection('journey')->table('attribution_journeys')->insertOrIgnore($rows->map(fn ($row) => (array) $row)->all());
                $count += $rows->count();
                usleep(100000); // Avoid a burst against the production root disk.
            }, 'id');
            $destination = DB::connection('journey')->table('attribution_journeys')->count();
            $this->line(json_encode(['copied' => $count, 'destination_rows' => $destination]));

            return $count <= $destination ? self::SUCCESS : self::FAILURE;
        }

        $this->info('Volume attribution schema ready.');

        return self::SUCCESS;
    }
}
