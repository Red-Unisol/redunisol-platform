<?php

namespace App\Services;

use App\Jobs\ReconcileWebFormAcknowledgement;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;

class WebFormReceipt
{
    // Shared with the outgoing claim: a form accepted before that claim wins.
    public function serialized(string $hash, Closure $callback): mixed
    {
        return DB::transaction(function () use ($hash, $callback) {
            DB::table('web_form_recipients')->insertOrIgnore([
                'phone_hash' => $hash, 'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('web_form_recipients')->where('phone_hash', $hash)->lockForUpdate()->first();

            return $callback();
        }, 5);
    }

    public function identityHash(string $cuil): ?string
    {
        // Bitrix exposes the lead CUIL field as a double. Accept its exact integer
        // representation, without rounding a fractional value into a different identity.
        $cuil = trim($cuil);
        if (preg_match('/^([0-9]+)\.([0-9]+)$/D', $cuil, $decimal)) {
            if (trim($decimal[2], '0') !== '') {
                return null;
            }
            $cuil = $decimal[1];
        }
        $digits = preg_replace('/\D/', '', $cuil);

        return preg_match('/^[0-9]{11}$/D', $digits)
            ? hash_hmac('sha256', 'web-form-identity:'.$digits, (string) config('app.key')) : null;
    }

    public function register(array $input): string
    {
        $id = $input['_journey_links']['submission_id'] ?? '';
        $hash = (new AttributionJourney)->phoneHash((string) ($input['celular'] ?? ''));
        if (! Str::isUuid($id)) {
            throw new RuntimeException('Web form identity is incomplete.');
        }
        $reference = Str::random(32);
        $this->serialized($hash ?? hash('sha256', $id), function () use ($input, $id, $hash, $reference) {
            DB::table('web_form_receipts')->insert([
                'id' => $id, 'reference_hash' => hash('sha256', $reference), 'phone_hash' => $hash,
                'identity_hash' => $this->identityHash((string) ($input['cuil'] ?? '')),
                'journey_id' => $input['attribution']['journey_id'] ?? null,
                'state' => 'pending', 'source' => 'web_server', 'received_at' => now(),
                'expires_at' => now()->addDay(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        return $reference;
    }

    public function claimDispatch(array $input, ?string $guardedPayload = null, bool $qualified = false, array $context = []): bool
    {
        $id = $input['_journey_links']['submission_id'];

        return DB::transaction(function () use ($id, $input, $guardedPayload, $qualified, $context): bool {
            $receipt = DB::table('web_form_receipts')->where('id', $id)->lockForUpdate()->first();
            if (! $receipt) {
                throw new RuntimeException('Missing web submission receipt.');
            }
            if ($receipt->crm_dispatched_at !== null || $receipt->state === 'synced') {
                return false;
            }
            // The database queue shares the transaction with the claim. A worker
            // crash before/after the POST leaves the original payload and an independent verifier.
            $job = new ReconcileWebFormAcknowledgement($input, $qualified, $context, $guardedPayload);
            Queue::connection('edna')->later(now()->addMinutes(2), $job, '', 'web-forms-reconcile');
            DB::table('web_form_receipts')->where('id', $id)->update(['crm_dispatched_at' => now(), 'crm_payload_digest' => $guardedPayload === null ? null : hash('sha256', $guardedPayload)]);

            return true;
        });
    }

    public function claimWrite(string $id, string $digest): array
    {
        return DB::transaction(function () use ($id, $digest): array {
            $row = DB::table('web_form_receipts')->where('id', $id)->lockForUpdate()->first();
            if (! $row || ! $row->crm_payload_digest || ! $row->crm_dispatched_at || $row->crm_ack_conflict_at || $row->state === 'failed'
                || ! hash_equals($row->crm_payload_digest, $digest)) {
                return ['state' => 'denied'];
            }
            if ($row->state === 'synced') {
                return ['state' => 'synced', 'lead_id' => $row->lead_id, 'contact_id' => $row->contact_id];
            }
            if ($row->crm_write_claimed_at !== null) {
                return ['state' => 'in_progress'];
            }
            // Never expire a granted write. The recipient may have lost its HTTP response.
            DB::table('web_form_receipts')->where('id', $id)->update(['crm_write_claimed_at' => now()]);

            return ['state' => 'granted'];
        });
    }

    public function reportLead(array $input, array $context, MetaConversionsApiService $meta): void
    {
        $id = $input['_journey_links']['submission_id'];
        $claimed = DB::table('web_form_receipts')->where('id', $id)->where('state', 'synced')
            ->whereNull('crm_ack_conflict_at')->whereNull('crm_meta_claimed_at')->update(['crm_meta_claimed_at' => now()]);
        if ($claimed) {
            $input['meta_event_id'] = $input['meta_event_id'] ?? $id;
            $meta->sendLead($input, $context);
        }
    }

    public function result(array $input, ?array $body, bool $successful): bool
    {
        $id = $input['_journey_links']['submission_id'] ?? null;
        if (! $id) {
            return false; // Already-queued jobs from before receipts existed.
        }
        $lead = (string) ($body['lead_id'] ?? '');
        $contact = (string) ($body['contact_id'] ?? '');
        $synced = $successful && ($body['ok'] ?? false) === true && preg_match('/^[1-9][0-9]{0,63}$/D', $lead);

        return DB::transaction(function () use ($id, $body, $lead, $contact, $synced, $input): bool {
            $receipt = DB::table('web_form_receipts')->where('id', $id)->lockForUpdate()->first();
            if (! $receipt || $receipt->crm_ack_conflict_at
                || ($receipt->crm_payload_digest && ! $receipt->crm_write_claimed_at && ($synced || $receipt->state === 'failed'))) {
                return false;
            }
            if ($receipt->crm_payload_digest && ! preg_match('/^[1-9][0-9]{0,63}$/D', $contact)) {
                $synced = false;
            }
            if ($receipt->state === 'synced') {
                if ($synced && ($receipt->lead_id !== $lead || ($receipt->crm_payload_digest && $receipt->contact_id !== $contact))) {
                    DB::table('web_form_receipts')->where('id', $id)->update(['state' => 'uncertain', 'crm_ack_conflict_at' => now(), 'updated_at' => now()]);
                    DB::table('web_form_continuations')->where('submission_id', $id)->where('state', '!=', 'released')->update([
                        'state' => 'review', 'reason' => 'web_form_conflicting_acknowledgements', 'lead_id' => null, 'updated_at' => now(),
                    ]);

                    return false;
                }

                return (bool) $synced;
            }
            DB::table('web_form_receipts')->where('id', $id)->update([
                'state' => $synced ? 'synced' : 'uncertain', 'lead_id' => $synced ? $lead : null,
                'contact_id' => $synced ? ($body['contact_id'] ?? null) : null,
                'persisted_at' => $synced ? now() : null, 'updated_at' => now(),
            ]);
            DB::table('web_form_continuations')->where('submission_id', $id)->where('state', '!=', 'released')->update([
                'state' => $synced ? 'ready' : 'review',
                'reason' => $synced ? 'web_form_already_processed' : 'web_form_persistence_uncertain',
                'lead_id' => $synced ? $lead : null, 'updated_at' => now(),
            ]);
            if ($synced) {
                try {
                    $profiles = app(EdnaOrganicProfile::class);
                    $answer = $profiles->websiteAnswer($input);
                    if ($answer) {
                        $profiles->record('web_form', $id, (string) ($input['celular'] ?? ''), $answer, $receipt->received_at,
                            $lead, isset($body['contact_id']) ? (string) $body['contact_id'] : null);
                    }
                } catch (\Throwable) {
                    // The primary receipt remains synced even if retention is unavailable.
                }
                foreach (DB::table('web_form_continuations')->where('submission_id', $id)->where('state', 'ready')->pluck('entry_event_id') as $entryEventId) {
                    app(WebFormChatRouting::class)->schedule((int) $entryEventId, $id);
                }
            }

            return (bool) $synced;
        });
    }

    public function failed(array $input, bool $finalCheck = false): ?string
    {
        $id = $input['_journey_links']['submission_id'] ?? null;
        if (! $id) {
            return null;
        }

        return DB::transaction(function () use ($id, $finalCheck): ?string {
            $receipt = DB::table('web_form_receipts')->where('id', $id)->lockForUpdate()->first();
            if (! $receipt || $receipt->state === 'synced' || $receipt->crm_ack_conflict_at
                || ($receipt->state === 'failed' && $receipt->crm_payload_digest && ! $receipt->crm_write_claimed_at)) {
                return $receipt->state ?? null;
            }
            $uncertain = $receipt->crm_dispatched_at !== null
                && (! $finalCheck || ! $receipt->crm_payload_digest || $receipt->crm_write_claimed_at);
            DB::table('web_form_receipts')->where('id', $id)->update([
                'state' => $uncertain ? 'uncertain' : 'failed', 'updated_at' => now(),
            ]);
            DB::table('web_form_continuations')->where('submission_id', $id)->whereNotIn('state', ['ready', 'released'])
                ->update(['state' => 'review', 'reason' => $uncertain ? 'web_form_persistence_uncertain' : 'web_form_persistence_failed',
                    'updated_at' => now()]);

            return $uncertain ? 'uncertain' : 'failed';
        });
    }
}
