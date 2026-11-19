<?php

namespace App\Console\Commands;

use App\Services\EdnaBenefitsRouting;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaBenefitsChats extends Command
{
    protected $signature = 'edna:benefits-chats {action=status : status, activate or poll} {--limit=25}';

    protected $description = 'Activate immutable routing of fresh Benefits replies, or inspect its technical receipts';

    public function handle(EdnaBenefitsRouting $service): int
    {
        $action = $this->argument('action');
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
        if (! in_array($action, ['status', 'activate', 'poll'], true) || $limit === false) {
            return self::INVALID;
        }
        if ($action === 'activate') {
            DB::transaction(function (): void {
                DB::table('edna_intake_cutovers')->insertOrIgnore(['name' => EdnaBenefitsRouting::NAME,
                    'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                    'starts_at' => CarbonImmutable::now('UTC')->addSecond()->startOfSecond()]);
            });
        }
        if ($action === 'poll') {
            $this->line(json_encode(['enqueued' => $service->poll($limit)], JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        $this->line(json_encode([
            'cutover' => DB::table('edna_intake_cutovers')->where('name', EdnaBenefitsRouting::NAME)->first(),
            'counts' => DB::table('edna_benefit_chat_routes')->selectRaw('state, reason, count(*) as total')->groupBy('state', 'reason')->get(),
            'recent' => DB::table('edna_benefit_chat_routes')->orderByDesc('updated_at')->limit($limit)
                ->get(['entry_event_id', 'chat_id', 'session_id', 'deal_id', 'target_id', 'state', 'reason',
                    'transfer_state', 'transfer_acknowledged', 'attempts', 'available_at', 'expires_at']),
        ], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
