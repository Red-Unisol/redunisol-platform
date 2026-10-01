<?php

namespace App\Http\Middleware;

use App\Services\AttributionJourney;
use Illuminate\Cookie\Middleware\EncryptCookies;

// API clients also send unsigned Meta cookies (_fbp/_fbc); leave those untouched.
class DecryptAttributionCookie extends EncryptCookies
{
    public function isDisabled($name): bool
    {
        return $name !== AttributionJourney::COOKIE;
    }
}
