<?php

namespace App\Console\Commands;

use App\Services\EdnaFreshIntake;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaIntakeCutover extends Command
{
    protected $signature = 'edna:intake-cutover {action=status : status or activate} {--fresh-declaration : Enable the new declaration contract after Kestra is deployed}';

    protected $description = 'Activate native V3 binding once for new incoming messages, without recovering old work';

    public function handle(): int
    {
        $action = $this->argument('action');
        if (! in_array($action, ['status', 'activate'], true)) {
            return self::INVALID;
        }
        $name = $this->option('fresh-declaration') ? EdnaFreshIntake::DECLARATION : 'native-v3-v1';
        if ($action === 'activate') {
            DB::transaction(function () use ($name): void {
                // Future deploys cannot move the boundary or make old entries eligible.
                DB::table('edna_intake_cutovers')->insertOrIgnore([
                    'name' => $name, 'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                    'starts_at' => now()->utc(),
                ]);
            });
        }
        $this->line(json_encode(['cutover' => DB::table('edna_intake_cutovers')->where('name', $name)->first()], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
