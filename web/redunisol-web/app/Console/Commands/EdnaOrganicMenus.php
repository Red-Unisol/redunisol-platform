<?php

namespace App\Console\Commands;

use App\Services\EdnaOrganicLoan;
use App\Services\EdnaOrganicMenu;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaOrganicMenus extends Command
{
    protected $signature = 'edna:organic-menus {action=status : status or poll} {--limit=25 : Maximum number of records}';

    protected $description = 'Inspect organic WhatsApp menus or recover bounded pending work';

    public function handle(EdnaOrganicMenu $menus): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 25]]);
        if (! in_array($this->argument('action'), ['status', 'poll'], true) || $limit === false) {
            $this->error('Use status or poll with a limit between 1 and 25.');

            return self::FAILURE;
        }
        if ($this->argument('action') === 'status') {
            $this->line(json_encode([
                'counts' => DB::table('edna_organic_menus')->selectRaw('state, reason, count(*) as total')->groupBy('state', 'reason')->get(),
                'recent' => DB::table('edna_organic_menus')->orderByDesc('updated_at')->limit($limit)->get([
                    'id', 'entry_event_id', 'choice_event_id', 'chat_id', 'session_id', 'state', 'reason',
                    'send_state', 'flow_send_id', 'seller_id', 'deal_id', 'transfer_state', 'attempts',
                ]),
            ], JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        $loans = app(EdnaOrganicLoan::class)->poll($limit);
        $menuCount = $loans < $limit ? $menus->poll($limit - $loans) : 0;
        $this->line(json_encode(['enqueued' => $loans + $menuCount, 'loan_enqueued' => $loans, 'menu_enqueued' => $menuCount], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
