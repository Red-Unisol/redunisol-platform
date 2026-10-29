<?php

namespace App\Jobs\Middleware;

trait TracksJourney
{
    public function middleware(): array
    {
        return [new JourneyJobMiddleware];
    }
}
