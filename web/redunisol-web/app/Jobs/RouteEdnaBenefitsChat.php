<?php

namespace App\Jobs;

use App\Services\EdnaBenefitsRouting;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class RouteEdnaBenefitsChat implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 105;

    public function __construct(public readonly int $entryEventId) {}

    public function handle(): void
    {
        app(EdnaBenefitsRouting::class)->process($this->entryEventId);
    }
}
