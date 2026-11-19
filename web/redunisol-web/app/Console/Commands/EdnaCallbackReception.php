<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class EdnaCallbackReception extends Command
{
    protected $signature = 'edna:callback-reception {action=status : status or arm}';

    protected $description = 'Exclude callbacks predating a deliberate provider delivery restoration, without replaying messages';

    public function handle(): int
    {
        $action = $this->argument('action');
        if (! in_array($action, ['status', 'arm'], true)) {
            return self::INVALID;
        }
        if ($action === 'arm') {
            DB::table('edna_intake_cutovers')->insert([
                'name' => 'callback-reception:'.Str::uuid(),
                'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                // SQL timestamps have second precision. Choose the next whole
                // second so no message predating this command can slip through.
                'starts_at' => now()->utc()->startOfSecond()->addSecond(),
            ]);
        }
        $this->line(json_encode(['accept_from_utc' => app(\App\Services\EdnaCallbackReception::class)->floor()?->toIso8601String()], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
