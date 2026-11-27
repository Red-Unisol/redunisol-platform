<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** Immutable deployment boundary: old inbox entries and late old callbacks stay on their original path. */
class EdnaFreshIntake
{
    public const CONTACT_DEAL = 'contact-deal-activity-v1';

    public const DECLARATION = 'fresh-v3-declaration-v1';

    public const OWNERSHIP = 'commercial-chat-ownership-v1';

    public const V3_VALIDITY = 'v3-validity-v1';

    public const REVIEW_SELLER = 'review-seller-v1';

    public function webOwnership(string $receivedAt): bool
    {
        $cut = DB::table('edna_intake_cutovers')->where('name', self::OWNERSHIP)->value('starts_at');

        return $cut !== null && CarbonImmutable::parse($receivedAt)->gte(CarbonImmutable::parse($cut));
    }

    public function declaration(object $send): bool
    {
        $event = DB::table('edna_incoming_events')->find($send->entry_event_id);

        return $event !== null && $this->entry($event, self::DECLARATION);
    }

    public function applies(object $send): bool
    {
        $event = DB::table('edna_incoming_events')->find($send->entry_event_id);

        return $event !== null && $this->entry($event);
    }

    public function entry(object $event, string $cutover = 'native-v3-v1'): bool
    {
        $cut = DB::table('edna_intake_cutovers')->where('name', $cutover)->first();

        return $cut && $this->entryAfter($event, $cut);
    }

    public function entryAfter(object $event, object $cut): bool
    {
        if ((int) $event->id <= (int) $cut->entry_id_after) {
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
