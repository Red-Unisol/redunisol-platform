<?php

namespace App\Console\Commands;

use App\Services\WebFormChatRouting;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class WebFormChatRoutes extends Command
{
    protected $signature = 'edna:web-chat-routes {action=poll : status or poll} {--limit=25 : Maximum number of records}';

    protected $description = 'Recover pending web-form chat links and reconcile uncertain transfer acknowledgements';

    public function handle(WebFormChatRouting $routing): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
        if (! in_array($this->argument('action'), ['poll', 'status'], true) || $limit === false) {
            $this->error('Use status or poll with a limit between 1 and 100.');

            return self::FAILURE;
        }
        if ($this->argument('action') === 'status') {
            $this->line(json_encode([
                'counts' => DB::table('web_form_chat_routes')->selectRaw('state, reason, count(*) as total')->groupBy('state', 'reason')->get(),
                'recent' => DB::table('web_form_chat_routes')->orderByDesc('updated_at')->limit($limit)
                    ->get(['entry_event_id', 'submission_id', 'state', 'reason', 'deal_id', 'seller_id', 'link_state', 'transfer_state', 'attempts']),
            ], JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        $this->line(json_encode(['enqueued' => $routing->poll($limit)], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
