<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** A recovery boundary applies before inbox persistence or dispatch, never as a replay job. */
class EdnaCallbackReception
{
    public function floor(): ?CarbonImmutable
    {
        $value = DB::table('edna_intake_cutovers')->where('name', 'like', 'callback-reception:%')->max('starts_at');

        return $value ? CarbonImmutable::parse($value) : null;
    }

    public function classify(string $receivedAt, CarbonImmutable $floor): string
    {
        if (! preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $receivedAt)) {
            return 'invalid';
        }
        try {
            $received = CarbonImmutable::parse($receivedAt);

            return $received->lt($floor) ? 'old' : 'new';
        } catch (\Throwable) {
            return 'invalid';
        }
    }
}
