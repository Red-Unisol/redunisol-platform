<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** A new discovery strategy cannot wake historical waiting chat routes. */
class EdnaDealMessageCutover
{
    public const NAME = 'deal-message-binding-v1';

    public function applies(object $event, array $payload): bool
    {
        if (! Schema::hasTable('edna_intake_cutovers')) {
            return false;
        }
        $cut = DB::table('edna_intake_cutovers')->where('name', self::NAME)->first();
        if (! $cut || (int) $event->id <= (int) $cut->entry_id_after
            || ($payload['id'] ?? null) !== (string) $event->message_id
            || ($payload['subjectId'] ?? null) !== (string) $event->subject_id
            || (string) $event->subject_id !== (string) config('edna.subject_id')) {
            return false;
        }
        try {
            $stored = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return false;
        }
        if (($stored['receivedAt'] ?? null) !== ($payload['receivedAt'] ?? null)) {
            return false;
        }
        $received = $stored['receivedAt'] ?? null;
        if (! is_string($received) || ! preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $received)) {
            return false;
        }
        try {
            return CarbonImmutable::parse($received)->gte(CarbonImmutable::parse($cut->starts_at));
        } catch (\Throwable) {
            return false;
        }
    }
}
