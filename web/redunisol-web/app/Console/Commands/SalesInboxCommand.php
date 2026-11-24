<?php

namespace App\Console\Commands;

use App\Services\SalesInbox;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SalesInboxCommand extends Command
{
    protected $signature = 'sales:inbox {action=status : status or poll} {--date= : Sessions opened on YYYY-MM-DD in Buenos Aires}';

    protected $description = 'Reconcile new native VENTAS sessions and report their dispositions';

    public function handle(SalesInbox $inbox): int
    {
        if ($this->argument('action') === 'status') {
            $sessions = DB::table('sales_inbox_sessions');
            $attempts = DB::table('web_form_http_attempts')->whereNotNull('snapshot');
            $receipts = DB::table('web_form_receipts');
            $day = $this->option('date');
            if ($day !== null) {
                if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $day, $parts) || ! checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
                    $this->error('Invalid Buenos Aires calendar date.');

                    return self::INVALID;
                }
                $from = CarbonImmutable::parse($day, 'America/Argentina/Buenos_Aires');
                foreach ([[$sessions, 'opened_at'], [$attempts, 'created_at'], [$receipts, 'received_at']] as [$query, $field]) {
                    $query->where($field, '>=', $from->utc())->where($field, '<', $from->addDay()->utc());
                }
            }
            $cursor = DB::table('sales_inbox_cursors')->where('line_id', 1)->first();
            $now = CarbonImmutable::now()->utc();
            $overdue = (clone $sessions)->whereIn('state', ['pending', 'waiting', 'waiting_customer', 'uncertain'])->where('available_at', '<=', $now);
            $oldest = (clone $overdue)->min('available_at');
            $age = static fn (?string $at): ?int => $at === null ? null : max(0, $now->timestamp - CarbonImmutable::parse($at, 'UTC')->timestamp);
            $this->line(json_encode([
                'enabled' => (bool) config('edna.sales_inbox_enabled') && (bool) config('edna.intake_crm_enabled'),
                'opened_on_art' => $day, 'cursor' => $cursor, 'cursor_age_seconds' => $age($cursor?->scanned_until),
                'overdue_sessions' => $overdue->count(), 'oldest_overdue_seconds' => $age($oldest),
                'dispositions' => (clone $sessions)->selectRaw('channel, state, reason, count(*) as total')->groupBy('channel', 'state', 'reason')
                    ->orderBy('channel')->orderBy('state')->orderBy('reason')->get(),
                'web_forms' => [
                    'awaiting_crm_job' => (clone $attempts)->count(),
                    'oldest_awaiting_crm_job_seconds' => $age((clone $attempts)->min('created_at')),
                    'receipts_by_state' => $receipts->selectRaw('state, count(*) as total')->groupBy('state')->orderBy('state')->get(),
                ],
                'oldest_needing_attention' => (clone $sessions)->where('state', 'needs_attention')->orderBy('opened_at')->orderBy('session_id')
                    ->limit(10)->get(['session_id', 'channel', 'reason', 'opened_at']),
            ], JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        if ($this->argument('action') !== 'poll' || $this->option('date') !== null) {
            return self::INVALID;
        }
        if (config('edna.sales_inbox_enabled') && config('edna.intake_crm_enabled')) {
            $inbox->poll();
        }

        return self::SUCCESS;
    }
}
