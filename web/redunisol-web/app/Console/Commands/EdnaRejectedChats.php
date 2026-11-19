<?php

namespace App\Console\Commands;

use App\Services\EdnaRejectedChatClosure;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaRejectedChats extends Command
{
    protected $signature = 'edna:rejected-chats {action=status : status or poll} {--limit=25}';

    protected $description = 'Close unattended rejected sessions only after their exact native notice is verified';

    public function handle(EdnaRejectedChatClosure $service): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
        if ($limit === false || ! in_array($this->argument('action'), ['status', 'poll'], true)) {
            $this->error('Use status or poll and a limit from 1 to 100.');

            return self::FAILURE;
        }
        if ($this->argument('action') === 'status') {
            $this->line(json_encode(['counts' => DB::table('edna_rejected_chat_closures')->selectRaw('state, reason, count(*) as total')->groupBy('state', 'reason')->get(),
                'recent' => DB::table('edna_rejected_chat_closures')->orderByDesc('updated_at')->limit($limit)
                    ->get(['id', 'chat_id', 'session_id', 'lead_id', 'state', 'reason', 'attempts', 'close_acknowledged', 'available_at'])], JSON_THROW_ON_ERROR));
        } else {
            $this->line(json_encode(['enqueued' => $service->poll($limit)], JSON_THROW_ON_ERROR));
        }

        return self::SUCCESS;
    }
}
