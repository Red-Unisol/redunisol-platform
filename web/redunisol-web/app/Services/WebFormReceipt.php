<?php

namespace App\Services;

use Closure;
use Illuminate\Support\Facades\DB;
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

    public function result(array $input, ?array $body, bool $successful): void
    {
        $id = $input['_journey_links']['submission_id'] ?? null;
        if (! $id) {
            return; // Already-queued jobs from before receipts existed.
        }
        $lead = (string) ($body['lead_id'] ?? '');
        $synced = $successful && ($body['ok'] ?? false) === true && preg_match('/^[1-9][0-9]{0,63}$/D', $lead);
        DB::transaction(function () use ($id, $body, $lead, $synced) {
            $receipt = DB::table('web_form_receipts')->where('id', $id)->lockForUpdate()->first();
            if (! $receipt) {
                return;
            }
            if ($receipt->state === 'synced') {
                if ($synced && $receipt->lead_id !== $lead) {
                    DB::table('web_form_receipts')->where('id', $id)->update(['state' => 'uncertain', 'updated_at' => now()]);
                    DB::table('web_form_continuations')->where('submission_id', $id)->update([
                        'state' => 'review', 'reason' => 'web_form_conflicting_acknowledgements', 'lead_id' => null, 'updated_at' => now(),
                    ]);
                }

                return;
            }
            DB::table('web_form_receipts')->where('id', $id)->update([
                'state' => $synced ? 'synced' : 'uncertain', 'lead_id' => $synced ? $lead : null,
                'contact_id' => $synced ? ($body['contact_id'] ?? null) : null,
                'persisted_at' => $synced ? now() : null, 'updated_at' => now(),
            ]);
            DB::table('web_form_continuations')->where('submission_id', $id)->update([
                'state' => $synced ? 'ready' : 'review',
                'reason' => $synced ? 'web_form_already_processed' : 'web_form_persistence_uncertain',
                'lead_id' => $synced ? $lead : null, 'updated_at' => now(),
            ]);
            if ($synced) {
                foreach (DB::table('web_form_continuations')->where('submission_id', $id)->where('state', 'ready')->pluck('entry_event_id') as $entryEventId) {
                    app(WebFormChatRouting::class)->schedule((int) $entryEventId, $id);
                }
            }
        });
    }

    public function failed(array $input): void
    {
        $id = $input['_journey_links']['submission_id'] ?? null;
        if ($id) {
            DB::table('web_form_receipts')->where('id', $id)->where('state', '!=', 'synced')
                ->update(['state' => 'failed', 'updated_at' => now()]);
            DB::table('web_form_continuations')->where('submission_id', $id)->where('state', '!=', 'ready')
                ->update(['state' => 'review', 'reason' => 'web_form_persistence_failed', 'updated_at' => now()]);
        }
    }
}
