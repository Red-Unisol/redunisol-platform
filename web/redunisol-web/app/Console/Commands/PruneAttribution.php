<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PruneAttribution extends Command
{
    protected $signature = 'attribution:prune {--apply : Remove expired encrypted acquisition snapshots}';

    protected $description = 'Count expired journeys; --apply deletes only expired rows, never CRM history';

    public function handle(): int
    {
        $query = DB::table('attribution_journeys')->where('expires_at', '<=', now());
        $count = $this->option('apply') ? $query->delete() : $query->count();
        $this->line(json_encode(['expired' => $count, 'applied' => (bool) $this->option('apply')]));

        return self::SUCCESS;
    }
}
