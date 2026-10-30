<?php

namespace App\Services;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class EdnaIntakePilot
{
    public const CAPACITY = 10;

    public const DEFAULT_NAME = 'website-intake-10-v1';

    public function capacity(): ?int
    {
        $value = config('edna.intake_pilot_limit', self::CAPACITY);
        // Only this explicit value removes the quota. Numeric zero and invalid
        // configuration still fail closed. Stored capacity 0 means unlimited.
        if ($value === 'unlimited') {
            return 0;
        }
        if (! is_int($value) && ! is_string($value)) {
            return null;
        }
        $limit = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000]]);

        return $limit === false ? null : $limit;
    }

    public function name(): ?string
    {
        $name = (string) config('edna.intake_pilot_id', self::DEFAULT_NAME);

        return preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $name) ? $name : null;
    }

    // Caller keeps this transaction open through the Flow reservation and queue insert.
    public function reserve(string $subject, string $phone, string $flowId, bool $acceptNew): ?object
    {
        $name = $this->name();
        $hash = (new AttributionJourney)->phoneHash($phone);
        if (! $name || ! $hash) {
            return null;
        }
        $key = hash('sha256', $subject.':'.$name);
        $capacity = $this->capacity();
        if (! $acceptNew || $capacity === null) {
            // Ineligible traffic must not create/pin a batch before its activation.
            return DB::table('edna_intake_admissions as a')
                ->join('edna_intake_pilots as p', 'p.id', '=', 'a.pilot_key')
                ->where('a.pilot_key', $key)->where('a.recipient_hash', $hash)
                ->select('a.*', 'p.flow_id', 'p.capacity')->first();
        }

        return DB::transaction(function () use ($key, $name, $subject, $flowId, $hash, $capacity) {
            DB::table('edna_intake_pilots')->insertOrIgnore([
                'id' => $key, 'name' => $name, 'subject_id' => $subject, 'flow_id' => $flowId,
                'capacity' => $capacity,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            // Serializes every admission, including two events for the same phone.
            $pilot = DB::table('edna_intake_pilots')->where('id', $key)->lockForUpdate()->first();
            $existing = DB::table('edna_intake_admissions')->where('pilot_key', $key)->where('recipient_hash', $hash)->first();
            if ($existing) {
                return (object) [...(array) $existing, 'flow_id' => $pilot->flow_id, 'capacity' => $pilot->capacity];
            }
            if ($pilot->flow_id !== $flowId) {
                return null;
            }
            // The conditional write also enforces the limit on databases without row locks.
            $claimed = DB::table('edna_intake_pilots')->where('id', $key)
                ->when((int) $pilot->capacity !== 0, fn ($query) => $query->where('admitted', '<', $pilot->capacity))
                ->increment('admitted', 1, ['updated_at' => now()]);
            if (! $claimed) {
                return null;
            }
            $slot = (int) DB::table('edna_intake_pilots')->where('id', $key)->value('admitted');
            $id = DB::table('edna_intake_admissions')->insertGetId([
                'pilot_key' => $key, 'recipient_hash' => $hash, 'slot' => $slot,
                'created_at' => now(), 'updated_at' => now(),
            ]);

            return (object) ['id' => $id, 'pilot_key' => $key, 'slot' => $slot, 'flow_id' => $flowId, 'capacity' => $pilot->capacity];
        }, 5);
    }

    public function contains(object $send): bool
    {
        if (empty($send->intake_admission_id) || empty($send->recipient)) {
            return false;
        }
        $hash = (new AttributionJourney)->phoneHash(Crypt::decryptString($send->recipient));

        return $hash !== null && DB::table('edna_intake_admissions as a')
            ->join('edna_intake_pilots as p', 'p.id', '=', 'a.pilot_key')
            ->where('a.id', $send->intake_admission_id)->where('a.recipient_hash', $hash)
            ->where('p.subject_id', $send->subject_id)->where('p.flow_id', $send->flow_id)->exists();
    }
}
