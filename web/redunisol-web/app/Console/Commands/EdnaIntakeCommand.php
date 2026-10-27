<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaIntakeCommand extends Command
{
    protected $signature = 'edna:intake {action=status : status or prune} {id?} {--apply : Remove old completed encrypted answers}';

    protected $description = 'Inspect website WhatsApp intake without identity data; never sends messages or replays CRM writes';

    public function handle(): int
    {
        $query = DB::table('edna_intake_requests');
        if ($this->argument('action') === 'status') {
            $id = $this->argument('id');
            if ($id !== null && ! ctype_digit((string) $id)) {
                return self::FAILURE;
            }
            $this->line(json_encode($query->when($id !== null, fn ($q) => $q->where('id', $id))
                ->latest('id')->limit(50)->get(['id', 'flow_send_id', 'response_event_id', 'state', 'reason', 'lead_id', 'contact_id', 'created_at'])));

            return self::SUCCESS;
        }
        if ($this->argument('action') === 'prune') {
            // Review/unknown records retain their encrypted answer until reconciliation.
            $query->where('state', 'synced')->where('updated_at', '<', now()->subDays(30))->whereNotNull('answer');
            $count = $query->count();
            if ($this->option('apply')) {
                $query->update(['answer' => null]);
            }
            $this->line(json_encode(['eligible' => $count, 'applied' => (bool) $this->option('apply')]));

            return self::SUCCESS;
        }

        return self::FAILURE;
    }
}
