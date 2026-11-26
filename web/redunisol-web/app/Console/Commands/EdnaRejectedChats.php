<?php

namespace App\Console\Commands;

use App\Services\EdnaRejectedChatClosure;
use App\Services\EdnaRejectedDealDiscovery;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaRejectedChats extends Command
{
    protected $signature = 'edna:rejected-chats {action=status : status, poll or activate-deals} {--limit=25}';

    protected $description = 'Close unattended rejected sessions only after their exact native notice is verified';

    public function handle(EdnaRejectedChatClosure $service): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
        $action = $this->argument('action');
        if ($limit === false || ! in_array($action, ['status', 'poll', 'activate-deals'], true)) {
            $this->error('Use status, poll or activate-deals and a limit from 1 to 100.');

            return self::FAILURE;
        }
        if ($action === 'activate-deals') {
            if ($service->enabled()) {
                DB::transaction(function (): void {
                    DB::table('edna_intake_cutovers')->insertOrIgnore([
                        'name' => EdnaRejectedDealDiscovery::CUTOVER,
                        'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                        'starts_at' => CarbonImmutable::now('UTC')->addSecond()->startOfSecond(),
                    ]);
                });
            }
            $this->line(json_encode(['enabled' => $service->enabled(), 'deal_cutover' => EdnaRejectedDealDiscovery::cutover()], JSON_THROW_ON_ERROR));
        } elseif ($action === 'status') {
            $this->line(json_encode(['deal_cutover' => EdnaRejectedDealDiscovery::cutover(),
                'counts' => DB::table('edna_rejected_chat_closures')->selectRaw('state, reason, count(*) as total')->groupBy('state', 'reason')->get(),
                'recent' => DB::table('edna_rejected_chat_closures')->orderByDesc('updated_at')->limit($limit)
                    ->get(['id', 'chat_id', 'session_id', 'lead_id', 'deal_id', 'state', 'reason', 'attempts', 'close_acknowledged', 'available_at'])], JSON_THROW_ON_ERROR));
        } else {
            $this->line(json_encode(['enqueued' => $service->poll($limit)], JSON_THROW_ON_ERROR));
        }

        return self::SUCCESS;
    }
}
