<?php

namespace App\Jobs;

use App\Services\WebFormHttpAttempt;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class RecoverWebFormHttpAttempt implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 0;

    public int $timeout = 75;

    public function __construct(public readonly string $key) {}

    public function backoff(): array
    {
        return [60, 120, 300, 900, 1800];
    }

    public function handle(WebFormHttpAttempt $attempts): void
    {
        $attempts->complete($this->key);
    }
}
