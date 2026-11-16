<?php

namespace App\Jobs;

use App\Services\EdnaOrganicLoan;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class SubmitEdnaOrganicLoan implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 115; // Below the edna connection's 120-second visibility timeout.

    public function __construct(public readonly int $menuId) {}

    public function handle(): void
    {
        app(EdnaOrganicLoan::class)->submit($this->menuId);
    }
}
