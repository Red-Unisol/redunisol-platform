<?php

namespace App\Jobs;

use App\Services\EdnaOrganicMenu;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class ProcessEdnaOrganicMenu implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 105;

    public function __construct(public readonly int $menuId) {}

    public function handle(): void
    {
        app(EdnaOrganicMenu::class)->process($this->menuId);
    }
}
