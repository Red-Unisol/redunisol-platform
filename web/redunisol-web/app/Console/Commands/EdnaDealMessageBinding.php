<?php

namespace App\Console\Commands;

use App\Services\EdnaDealMessageCutover;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaDealMessageBinding extends Command
{
    protected $signature = 'edna:deal-message-binding {action=status : status or activate}';

    protected $description = 'Activate deal-owned native message discovery once, without replaying older entries';

    public function handle(): int
    {
        $action = $this->argument('action');
        if (! in_array($action, ['status', 'activate'], true)) {
            return self::INVALID;
        }
        if ($action === 'activate') {
            DB::transaction(function (): void {
                DB::table('edna_intake_cutovers')->insertOrIgnore([
                    'name' => EdnaDealMessageCutover::NAME,
                    'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                    'starts_at' => now()->utc()->startOfSecond()->addSecond(),
                ]);
            });
        }
        $this->line(json_encode(['cutover' => DB::table('edna_intake_cutovers')
            ->where('name', EdnaDealMessageCutover::NAME)->first()], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
