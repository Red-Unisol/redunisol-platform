<?php

namespace App\Jobs;

use App\Services\EdnaIntakeChatRouting;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

class RouteEdnaIntakeChat implements ShouldQueue
{
    use Queueable;

    public int $tries = 6;

    public int $timeout = 105;

    public function __construct(public readonly int $requestId) {}

    public function backoff(): array
    {
        return [15, 30, 60, 120, 300];
    }

    public function handle(): void
    {
        app(EdnaIntakeChatRouting::class)->route($this->requestId);
    }

    public function failed(?\Throwable $error): void
    {
        DB::table('edna_intake_chat_routes')->where('request_id', $this->requestId)->where('state', 'pending')
            ->update(['state' => 'review', 'reason' => 'routing_reads_exhausted', 'updated_at' => now()]);
    }
}
