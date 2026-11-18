<?php

namespace App\Jobs;

use App\Services\EdnaRejectedChatClosure;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class CloseEdnaRejectedChat implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 105;

    public function __construct(public readonly int $closureId) {}

    public function handle(): void
    {
        app(EdnaRejectedChatClosure::class)->process($this->closureId);
    }
}
