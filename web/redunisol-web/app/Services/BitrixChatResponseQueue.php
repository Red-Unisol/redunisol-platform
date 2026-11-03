<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BitrixChatResponseQueue
{
    public function capture(object $event, array $payload): void
    {
        $phone = (string) ($payload['subscriber']['identifier'] ?? '');
        if (! preg_match('/^[0-9]{10,15}$/D', $phone)
            || (new EdnaIntake)->isTestEntry((string) ($payload['messageContent']['text'] ?? ''))) {
            return;
        }
        try {
            $received = CarbonImmutable::parse($payload['receivedAt'] ?? '');
        } catch (\Throwable) {
            return;
        }
        if ($received->lt(now()->subDay()) || $received->gt(now()->addMinutes(5))) {
            return;
        }
        $this->enqueue('p:'.hash_hmac('sha256', $phone, (string) config('app.key')),
            ['phone' => $phone], (int) $event->id, null);
    }

    public function deal(int $id, string $source): void
    {
        $this->enqueue('d:'.$id, ['deal_id' => $id], 0, $source);
    }

    private function enqueue(string $key, array $payload, int $eventId, ?string $source): void
    {
        DB::transaction(function () use ($key, $payload, $eventId, $source): void {
            DB::table('bitrix_chat_response_queue')->insertOrIgnore([
                'key' => $key, 'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
                'version' => 0, 'event_id' => 0, 'available_at' => now(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $row = DB::table('bitrix_chat_response_queue')->where('key', $key)->lockForUpdate()->first();
            if (($eventId && $eventId <= $row->event_id) || ($source && $row->source === $source)) {
                return;
            }
            DB::table('bitrix_chat_response_queue')->where('key', $key)->update([
                'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
                'version' => $row->version + 1, 'event_id' => max($eventId, $row->event_id),
                'source' => $source, 'cursor' => 0, 'attempts' => 0,
                'available_at' => $row->version > $row->processed_version ? $row->available_at : now()->addSeconds(15),
                'outcome' => null, 'updated_at' => now(),
            ]);
        });
    }

    public function claim(): array
    {
        return DB::transaction(function (): array {
            DB::table('bitrix_chat_response_state')->insertOrIgnore(['id' => 1, 'created_at' => now(), 'updated_at' => now()]);
            $state = DB::table('bitrix_chat_response_state')->where('id', 1)->lockForUpdate()->first();
            if ($state->lease && CarbonImmutable::parse($state->lease_until)->isFuture()) {
                return ['mode' => 'busy'];
            }
            $job = DB::table('bitrix_chat_response_queue')->whereColumn('version', '>', 'processed_version')
                ->where('available_at', '<=', now())->orderBy('available_at')->orderBy('key')->lockForUpdate()->first();
            if (! $job && $state->next_fallback_at && CarbonImmutable::parse($state->next_fallback_at)->isFuture()) {
                return ['mode' => 'idle'];
            }
            $lease = (string) Str::uuid();
            DB::table('bitrix_chat_response_state')->where('id', 1)->update([
                'lease' => $lease, 'lease_until' => now()->addSeconds(config('chat_response.lease_seconds')),
                'job_key' => $job?->key, 'job_version' => $job?->version, 'updated_at' => now(),
            ]);
            if ($job) {
                DB::table('bitrix_chat_response_queue')->where('key', $job->key)->increment('attempts');
            }

            return ['mode' => $job ? 'event' : 'fallback', 'lease' => $lease,
                'cursor' => (int) ($job?->cursor ?? $state->cursor), 'attempts' => (int) ($job?->attempts ?? 0) + 1,
                'payload' => $job ? json_decode(Crypt::decryptString($job->payload), true, 8, JSON_THROW_ON_ERROR) : []];
        });
    }

    public function updateLease(string $lease, ?array $result = null): void
    {
        DB::transaction(function () use ($lease, $result): void {
            $state = DB::table('bitrix_chat_response_state')->where('id', 1)->lockForUpdate()->first();
            if (! $state || ! $state->lease || ! hash_equals($state->lease, $lease)
                || ! CarbonImmutable::parse($state->lease_until)->isFuture()) {
                throw new DomainException('stale_lease');
            }
            if ($result === null) {
                DB::table('bitrix_chat_response_state')->where('id', 1)->update([
                    'lease_until' => now()->addSeconds(config('chat_response.lease_seconds')), 'updated_at' => now(),
                ]);

                return;
            }
            if ($state->job_key) {
                $job = DB::table('bitrix_chat_response_queue')->where('key', $state->job_key)->lockForUpdate()->first();
                $sameVersion = (int) $job->version === (int) $state->job_version;
                $done = $result['outcome'] === 'completed' || ($result['outcome'] === 'error' && $job->attempts >= 6);
                DB::table('bitrix_chat_response_queue')->where('key', $job->key)->update([
                    'processed_version' => $done ? $state->job_version : $job->processed_version,
                    'cursor' => $sameVersion ? $result['cursor'] : 0,
                    'available_at' => $sameVersion ? now()->addSeconds(60) : now(),
                    'outcome' => $result['outcome'], 'updated_at' => now(),
                ]);
            }
            $values = ['lease' => null, 'lease_until' => null, 'job_key' => null, 'job_version' => null,
                'last_result' => json_encode($result, JSON_THROW_ON_ERROR), 'updated_at' => now()];
            if (! $state->job_key) {
                $values += ['cursor' => $result['cursor'],
                    'next_fallback_at' => now()->addSeconds(config('chat_response.fallback_seconds'))];
            }
            DB::table('bitrix_chat_response_state')->where('id', 1)->update($values);
        });
    }
}
