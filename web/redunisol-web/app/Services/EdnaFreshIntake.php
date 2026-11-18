<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** Immutable deployment boundary: old inbox entries and late old callbacks stay on their original path. */
class EdnaFreshIntake
{
    public const CONTACT_DEAL = 'contact-deal-activity-v1';

    public function applies(object $send): bool
    {
        $event = DB::table('edna_incoming_events')->find($send->entry_event_id);

        return $event !== null && $this->entry($event);
    }

    public function entry(object $event, string $cutover = 'native-v3-v1'): bool
    {
        $cut = DB::table('edna_intake_cutovers')->where('name', $cutover)->first();
        if (! $cut || (int) $event->id <= (int) $cut->entry_id_after) {
            return false;
        }
        try {
            $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);

            return ($payload['id'] ?? null) === $event->message_id
                && ($payload['subjectId'] ?? null) === $event->subject_id
                && $event->subject_id === (string) config('edna.subject_id')
                && preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', (string) ($payload['receivedAt'] ?? ''))
                && CarbonImmutable::parse($payload['receivedAt'])->gte(CarbonImmutable::parse($cut->starts_at));
        } catch (\Throwable) {
            return false;
        }
    }
}
