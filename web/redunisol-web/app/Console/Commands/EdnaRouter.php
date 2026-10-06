<?php

namespace App\Console\Commands;

use App\Jobs\ReconcileEdnaFlow;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

class EdnaRouter extends Command
{
    protected $signature = 'edna:router {action=status : status or reconcile} {id? : Send ledger ID}';

    protected $description = 'Inspect Flow sends without recipient data; reconcile history without resending';

    public function handle(): int
    {
        $action = $this->argument('action');
        $id = $this->argument('id');
        if (! in_array($action, ['status', 'reconcile'], true) || ($id !== null && ! ctype_digit((string) $id))) {
            $this->error('Use status [id] or reconcile <id>.');

            return self::FAILURE;
        }
        if ($action === 'status') {
            $query = DB::table('edna_flow_sends')->orderByDesc('id');
            if ($id !== null) {
                $query->where('id', (int) $id);
            }
            $this->line(json_encode($query->limit(50)->get(['id', 'state', 'reason', 'entry_event_id',
                'subject_id', 'flow_id', 'outgoing_message_id', 'response_event_id', 'created_at', 'completed_at'])));

            return self::SUCCESS;
        }
        $send = $id === null ? null : DB::table('edna_flow_sends')->where('id', (int) $id)->first();
        if (! $send || ! in_array($send->state, ['sending', 'accepted', 'unknown'], true)) {
            $this->error('Send must exist and await history confirmation.');

            return self::FAILURE;
        }
        Queue::connection('edna')->push(new ReconcileEdnaFlow($send->id), '', 'edna');
        $this->info('History reconciliation queued; no Flow will be sent.');

        return self::SUCCESS;
    }
}
