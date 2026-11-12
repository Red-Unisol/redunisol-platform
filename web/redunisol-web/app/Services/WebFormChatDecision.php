<?php

namespace App\Services;

use RuntimeException;

class WebFormChatDecision extends RuntimeException
{
    public function __construct(public readonly string $state, public readonly string $reason)
    {
        parent::__construct($reason);
    }
}
