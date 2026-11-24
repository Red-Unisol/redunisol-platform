<?php

namespace App\Services;

use App\Jobs\LinkWebFormChat;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class WebFormChatRouting
{
    public const COMMERCIAL_REVIEW_STAGES = ['C1:KESTRA_REVIEW', 'C1:KESTRA_ROUTE_REVIEW'];

    public function schedule(int $entryEventId, ?string $submissionId = null): bool
    {
        $event = DB::table('edna_incoming_events')->find($entryEventId);
        if (! $event || ! $event->payload) {
            return false;
        }
        try {
            $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return false;
        }
        $hash = is_array($payload) ? $this->authenticatedPhoneHash($event, $payload) : null;
        if (! $hash) {
            return false;
        }

        // The commercial wait is opt-in at first capture only. A backfill, retry
        // or duplicate callback must not extend a previous conversation.
        $waitUntil = null;
        $received = $payload['receivedAt'] ?? null;
        if ($submissionId && is_string($received) && preg_match('/(?:Z|[+-]\d{2}:\d{2})$/D', $received)) {
            try {
                $at = CarbonImmutable::parse($received)->utc();
                if ($at->lte(now()->addMinutes(5)) && $at->gt(now()->subHours(WebFormChatRetryPolicy::WINDOW_HOURS))) {
                    $waitUntil = $at->addDay();
                }
            } catch (Throwable) {
                // An invalid provider timestamp cannot earn additional routing time.
            }
        }

        return DB::transaction(function () use ($entryEventId, $submissionId, $hash, $waitUntil): bool {
            $inserted = DB::table('web_form_chat_routes')->insertOrIgnore([
                'entry_event_id' => $entryEventId, 'submission_id' => $submissionId, 'phone_hash' => $hash,
                'state' => 'pending', 'link_state' => 'pending', 'transfer_state' => 'pending', 'commercial_wait_until' => $waitUntil,
                'available_at' => now(), 'enqueued_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
            if (! $inserted) {
                // An existing event cannot silently adopt a different web case,
                // reset an uncertain write or enqueue a second original attempt.
                return false;
            }
            app(EdnaWorkQueue::class)->push(new LinkWebFormChat($entryEventId));

            return true;
        });
    }

    public function receiveReentry(object $event, array $payload): bool
    {
        if (preg_match('/\(solicitud\s*:/i', (string) ($payload['messageContent']['text'] ?? ''))) {
            // A new or invalid explicit reference must take the normal receipt
            // path, rather than being replaced by a historical phone candidate.
            return false;
        }
        $hash = $this->authenticatedPhoneHash($event, $payload);
        if (! $hash || ! $this->hasProvenHistory($hash)) {
            return false;
        }
        DB::table('web_form_continuations')->insertOrIgnore([
            'entry_event_id' => $event->id, 'submission_id' => null, 'state' => 'waiting',
            'reason' => 'web_chat_reentry', 'proof_source' => 'reentry',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $current = DB::table('web_form_continuations')->where('entry_event_id', $event->id)->first();
        if (! $current || $current->reason !== 'web_chat_reentry' || $current->submission_id !== null) {
            return false;
        }
        // This phone match only wakes resolution. No historical submission,
        // native chat or seller is selected before the exact message is proved.
        $this->schedule((int) $event->id);

        return true;
    }

    /** Old work is terminal locally; queued stale jobs then ACK without a CRM call. */
    public function expireDue(int $limit = 250): int
    {
        return DB::transaction(function () use ($limit): int {
            $rows = DB::table('web_form_chat_routes')->whereIn('state', ['pending', 'waiting', 'unknown'])
                ->where(fn ($q) => $q->whereNull('reason')->orWhere('reason', '!=', WebFormChatRetryPolicy::QUEUED_SELLER))
                ->where(fn ($q) => $q->where('retry_expires_at', '<=', now())
                    ->orWhere(fn ($legacy) => $legacy->whereNull('retry_expires_at')
                        ->where('created_at', '<=', now()->subHours(WebFormChatRetryPolicy::WINDOW_HOURS))))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->orderBy('created_at')->limit($limit)->lockForUpdate()->get();
            $policy = new WebFormChatRetryPolicy;
            foreach ($rows as $row) {
                DB::table('web_form_chat_routes')->where('entry_event_id', $row->entry_event_id)
                    ->update($policy->expiration($row) + ['updated_at' => now()]);
            }

            return $rows->count();
        });
    }

    public function poll(int $limit = 25): int
    {
        $this->expireDue();
        // A reservation is a wake-up hint only. The worker re-reads the CRM
        // owner and the native session before making any transfer.
        DB::table('web_form_chat_routes')->where('state', 'waiting')->where('reason', 'commercial_seller_not_ready')
            ->where('commercial_wait_until', '>', now())->where('transfer_state', 'pending')
            ->where('available_at', '>', now())->whereNull('lease_token')
            ->whereExists(function (Builder $q): void {
                $q->selectRaw('1')->from('bitrix_routing_allocations as allocation')
                    ->where('allocation.scope', 'redunisol.prod.marketing-crm')
                    ->whereRaw('allocation.deal_id = CAST(web_form_chat_routes.deal_id AS BIGINT)')
                    ->whereColumn('allocation.created_at', '>=', 'web_form_chat_routes.updated_at')
                    ->where('allocation.created_at', '<=', now()->subSeconds(15));
            })->update(['available_at' => now(), 'updated_at' => now()]);

        return DB::transaction(function () use ($limit): int {
            $queue = app(EdnaWorkQueue::class);
            $rows = $queue->withoutPending(DB::table('web_form_chat_routes'), LinkWebFormChat::class, 'web_form_chat_routes.entry_event_id')
                ->where(function ($q): void {
                    $q->whereIn('state', ['pending', 'waiting'])
                        ->orWhere(fn ($unknown) => $unknown->where('state', 'unknown')->whereIn('transfer_state', ['sending', 'unknown']));
                })
                ->where(fn ($q) => $q->where('reason', WebFormChatRetryPolicy::QUEUED_SELLER)->orWhere('retry_expires_at', '>', now())
                    ->orWhere(fn ($ordinary) => $ordinary->whereNull('retry_expires_at')
                        ->where('created_at', '>', now()->subHours(WebFormChatRetryPolicy::WINDOW_HOURS))))
                ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->where(fn ($q) => $q->whereNull('enqueued_at')->orWhere('enqueued_at', '<=', now()->subMinute()))
                ->orderByRaw('CASE WHEN attempts = 0 THEN 0 ELSE 1 END')
                ->orderByRaw('COALESCE(available_at, created_at)')->orderBy('entry_event_id')->limit($limit)->lockForUpdate()->get();
            $enqueued = 0;
            foreach ($rows as $row) {
                if ($queue->push(new LinkWebFormChat((int) $row->entry_event_id))) {
                    DB::table('web_form_chat_routes')->where('entry_event_id', $row->entry_event_id)->update([
                        'enqueued_at' => now(), 'updated_at' => now(),
                    ]);
                    $enqueued++;
                }
            }

            return $enqueued;
        });
    }

    private function authenticatedPhoneHash(object $event, array $payload): ?string
    {
        $subject = (string) config('edna.subject_id');
        if ($subject === '' || (string) $event->subject_id !== $subject
            || (string) ($payload['subjectId'] ?? '') !== $subject
            || (string) ($payload['id'] ?? '') !== (string) $event->message_id) {
            return null;
        }

        return (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
    }

    public function history(string $hash): Builder
    {
        return DB::table('web_form_chat_routes')->where('phone_hash', $hash)
            ->where(function ($q): void {
                $q->whereIn('state', ['routed', 'linked', 'preserved', 'waiting'])
                    ->orWhere(fn ($expired) => $expired->where('state', 'expired')->where('reason', 'retry_window_expired'));
            })
            ->whereNotIn('transfer_state', ['sending', 'unknown'])
            ->whereNotNull('submission_id')->whereNotNull('proof');
    }

    private function hasProvenHistory(string $hash): bool
    {
        $rows = $this->history($hash)->orderByDesc('entry_event_id')->limit(100)->get(['entry_event_id', 'submission_id', 'proof']);
        foreach ($rows as $row) {
            if ($this->validHistory($row)) {
                return true;
            }
        }

        return false;
    }

    public function validHistory(object $row): bool
    {
        if (! Str::isUuid($row->submission_id)) {
            return false;
        }
        $proof = json_decode($row->proof, true);
        if (! is_array($proof) || ($proof['verified'] ?? null) !== true
            || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id'
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $row->entry_event_id) {
            return false;
        }
        foreach (['chat_id', 'session_id', 'message_id', 'activity_id', 'entry_event_id', 'entry_message_id'] as $field) {
            $id = $proof[$field] ?? null;
            if ((! is_string($id) && ! is_int($id)) || ! preg_match('/^[1-9][0-9]{0,63}$/D', (string) $id)) {
                return false;
            }
        }

        return true;
    }
}
