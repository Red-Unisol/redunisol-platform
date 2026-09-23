<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('edna:prune {--days=30 : Retention of delivered payloads in days}', function () {
    $days = filter_var($this->option('days'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($days === false) {
        $this->error('days must be a positive integer.');

        return 1;
    }
    $count = DB::table('edna_incoming_events')->where('status', 'delivered')
        ->where('delivered_at', '<', now()->subDays($days))->whereNotNull('payload')
        ->update(['payload' => null, 'updated_at' => now()]);
    $this->info("Cleared {$count} delivered payloads; deduplication keys retained.");
    $sends = DB::table('edna_flow_sends')->whereIn('state', ['confirmed', 'completed', 'rejected', 'cancelled', 'expired', 'failed'])
        ->where('created_at', '<', now()->subDays(max(2, $days)))->whereNotNull('recipient')
        ->whereNotExists(function ($query) {
            $query->selectRaw('1')->from('edna_router_results')
                ->whereColumn('edna_router_results.flow_send_id', 'edna_flow_sends.id')
                ->where(function ($q) {
                    $q->whereNotIn('state', ['confirmed', 'rejected', 'cancelled', 'expired'])
                        ->orWhereNotIn('crm_state', ['synced', 'superseded', 'cancelled']);
                });
        })
        ->update(['recipient' => null, 'updated_at' => now()]);
    $this->info("Cleared {$sends} closed Flow recipients; uncertain sends retained for reconciliation.");

    return 0;
})->purpose('Remove old delivered Edna payloads while preserving deduplication');
