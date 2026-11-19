<?php

namespace App\Console\Commands;

use App\Services\WebChatContinuity;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaWebChatContinuity extends Command
{
    protected $signature = 'edna:web-chat-continuity {action=status : status or activate}';

    protected $description = 'Activate web-chat session continuity once, without inheriting historical callbacks';

    public function handle(): int
    {
        if (! in_array($this->argument('action'), ['status', 'activate'], true)) {
            return self::INVALID;
        }
        if ($this->argument('action') === 'activate') {
            DB::transaction(function (): void {
                DB::table('edna_intake_cutovers')->insertOrIgnore([
                    'name' => WebChatContinuity::NAME,
                    'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                    'starts_at' => now()->utc()->startOfSecond()->addSecond(),
                ]);
            });
        }
        $this->line(json_encode([
            'cutover' => DB::table('edna_intake_cutovers')->where('name', WebChatContinuity::NAME)->first(),
            'counts' => DB::table('web_chat_contexts')->selectRaw('state, count(*) as total')->groupBy('state')->get(),
        ], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
