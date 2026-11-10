<?php

namespace App\Jobs;

use App\Services\WebFormChatLinker;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class LinkWebFormChat implements ShouldQueue
{
    use Queueable;

    // The durable routing record, rather than a repeated queue attempt, owns
    // recovery and reconciliation of writes whose acknowledgement is uncertain.
    public int $tries = 1;

    public int $timeout = 105;

    public function __construct(public readonly int $entryEventId) {}

    public function handle(): void
    {
        app(WebFormChatLinker::class)->process($this->entryEventId);
    }
}
