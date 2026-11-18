<?php

namespace App\Services;

use App\Jobs\ProcessEdnaIntake;
use App\Jobs\RouteEdnaIntakeChat;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

/** A real completed V3 response for an existing native identity, using the existing profile contract. */
class EdnaNativeIntake
{
    public function process(object $request, object $send, array $proof): void
    {
        $deadline = microtime(true) + 105;
        if ($request->state !== 'pending' || ! app(EdnaFreshIntake::class)->applies($send) || ($proof['version'] ?? null) !== 2
            || $send->state !== 'completed' || (int) $send->response_event_id !== (int) $request->response_event_id
            || ! config('edna.enabled') || ! config('edna.intake_crm_enabled')) {
            return;
        }
        $current = DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')->first();
        if (! $current) {
            return;
        }
        $request = $current;
        $url = (string) config('edna.intake_processing_url');
        if (parse_url($url, PHP_URL_SCHEME) !== 'https'
            || ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_intake/')) {
            return;
        }
        $claimed = false;
        try {
            $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
            if ($entry && str_starts_with((string) $request->reason, 'benefits_wait:')
                && $this->benefitsDeadline($entry)->lte(now())) {
                $this->deferBenefits($request, $entry, 'benefits_preflight_expired');

                return;
            }
            $benefits = app(EdnaBenefitsRouting::class);
            $checkBenefits = $entry && $benefits->eligibleEntry($entry);
            if ($checkBenefits && $this->interceptBenefits($request, $entry, $proof, $benefits)) {
                return;
            }
            if (! $checkBenefits && $this->preserveNativeAttention($request, $proof)) {
                return;
            }
            $service = new EdnaIntake;
            $attribution = $service->attribution($send);
            $context = $service->entryContext($send);
            if (! $attribution || ! $context) {
                throw new RuntimeException('Fresh intake context unavailable.');
            }
            unset($attribution['wa']['WA_FLOW_ID']);
            $attribution['wa']['WA_FLOW'] = 'organic_profile_reuse';
            $answer = json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR);
            $body = ['contract' => EdnaOrganicLoan::CONTRACT, 'case_id' => $send->request_id,
                'phone' => Crypt::decryptString($send->recipient), 'dry_run' => false,
                'received_at' => CarbonImmutable::parse($request->received_at)->toIso8601String(), 'answer' => $answer,
                'entry_context' => $context, 'crm_binding' => array_replace($proof, ['version' => 1]), 'attribution' => $attribution,
                'provenance' => ['source_kind' => 'edna_intake_request', 'source_id' => (string) $request->id,
                    'schema' => 'whatsapp-intake-v3', 'v3_equivalent' => true,
                    'confirmed_at' => CarbonImmutable::parse($request->received_at)->toIso8601String()]];
            $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
            if ($entry && app(WebChatContinuity::class)->eligibleEntry($entry)) {
                $body['routing_policy'] = WebChatContinuity::NAME;
            }
            // This contract revalidates native message, CUIL and existing management in Kestra.
            // The actual Flow transport remains in edna_flow_sends and is never invented/replayed.
            if ($checkBenefits && ($this->interceptBenefits($request, $entry, $proof, $benefits)
                || $this->preserveNativeAttention($request, $proof))) {
                return;
            }
            if ($checkBenefits && microtime(true) + 63 >= $deadline) {
                // Do not claim a 60-second business POST when the worker can no
                // longer retain its acknowledgement. All retry work is pre-POST.
                $this->deferBenefits($request, $entry, 'benefits_preflight_budget_elapsed');

                return;
            }
            $claimed = (bool) DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')
                ->update(['state' => 'processing', 'updated_at' => now()]);
            if (! $claimed) {
                return;
            }
            $response = Http::asJson()->acceptJson()->connectTimeout(3)->timeout(60)->withoutRedirecting()->post($url, $body);
            $result = $response->json();
            if (! $response->successful() || ! is_array($result) || ($result['ok'] ?? null) !== true
                || ($result['contract'] ?? '') !== EdnaOrganicLoan::CONTRACT || ($result['case_id'] ?? '') !== $send->request_id
                || ! is_bool($result['write_attempted'] ?? null)) {
                throw new RuntimeException('Fresh intake acknowledgement uncertain.');
            }
            $action = $result['action'] ?? '';
            $assigned = $action === 'assigned_case' && $result['write_attempted'] === false;
            if ($assigned) {
                foreach (['deal_id', 'seller_id', 'contact_id'] as $key) {
                    if (! preg_match('/^[1-9][0-9]{0,18}$/D', (string) ($result[$key] ?? ''))) {
                        throw new RuntimeException('Assigned case acknowledgement invalid.');
                    }
                }
            }
            $synced = $assigned || in_array($action, ['queued', 'already_processed', 'rejected'], true);
            if ($synced && ! $assigned && ! preg_match('/^[1-9][0-9]{0,18}$/D', (string) ($result['lead_id'] ?? ''))) {
                throw new RuntimeException('Fresh intake CRM acknowledgement invalid.');
            }
            DB::transaction(function () use ($request, $proof, $answer, $result, $assigned, $synced): void {
                DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'processing')->update([
                    'state' => $synced ? 'synced' : 'review', 'reason' => $result['reason'] ?? 'native_intake_review',
                    'lead_id' => ($result['lead_id'] ?? null) ?: null, 'contact_id' => ($result['contact_id'] ?? null) ?: null, 'updated_at' => now(),
                ]);
                if ($assigned) {
                    $case = array_intersect_key($result, array_flip(['lead_id', 'contact_id', 'deal_id', 'seller_id']));
                    $case['identity_hash'] = (new WebFormReceipt)->identityHash($answer['cuil'] ?? '');
                    if (! $case['identity_hash']) {
                        throw new RuntimeException('Assigned case identity unavailable.');
                    }
                    if (DB::table('edna_intake_chat_routes')->insertOrIgnore([
                        'request_id' => $request->id, 'proof' => json_encode($proof, JSON_THROW_ON_ERROR),
                        'assigned_case' => json_encode($case, JSON_THROW_ON_ERROR), 'state' => 'pending',
                        'created_at' => now(), 'updated_at' => now(),
                    ])) {
                        Queue::connection('edna')->push(new RouteEdnaIntakeChat((int) $request->id), '', 'edna');
                    }
                }
            });
            if ($synced) {
                try {
                    app(EdnaOrganicProfile::class)->record('edna_intake_request', (string) $request->id, $body['phone'],
                        $answer, $request->received_at, ($result['lead_id'] ?? null) ?: null, ($result['contact_id'] ?? null) ?: null);
                } catch (Throwable) {
                    // Profile retention never replays an acknowledged application request.
                }
            }
        } catch (Throwable) {
            DB::table('edna_intake_requests')->where('id', $request->id)->whereIn('state', ['pending', 'processing'])->update([
                'state' => $claimed ? 'unknown' : 'review',
                'reason' => $claimed ? 'crm_acknowledgement_uncertain' : 'native_intake_preflight_unavailable', 'updated_at' => now(),
            ]);
        }
    }

    private function preserveNativeAttention(object $request, array $proof): bool
    {
        $attention = app(EdnaOrganicAttention::class)->inspectWelcome($proof);
        if (($attention['status'] ?? '') === 'ready') {
            return false;
        }
        DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')->update([
            'state' => 'review', 'reason' => $attention['reason'] ?? 'native_attention_unavailable', 'updated_at' => now(),
        ]);

        return true;
    }

    private function interceptBenefits(object $request, object $entry, array $proof, EdnaBenefitsRouting $benefits): bool
    {
        try {
            $decision = $benefits->check($entry, $proof);
        } catch (Throwable) {
            $decision = ['state' => 'waiting', 'reason' => 'benefits_preflight_unavailable'];
        }
        if ($decision === null) {
            return false;
        }
        if (($decision['state'] ?? '') === 'waiting') {
            $this->deferBenefits($request, $entry, (string) ($decision['reason'] ?? 'benefits_evidence_pending'));
        } else {
            DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')->update([
                'state' => 'review', 'reason' => substr((string) ($decision['reason'] ?? 'benefits_routing'), 0, 80), 'updated_at' => now(),
            ]);
        }

        return true;
    }

    private function benefitsDeadline(object $entry): CarbonImmutable
    {
        try {
            $payload = json_decode(Crypt::decryptString($entry->payload), true, 32, JSON_THROW_ON_ERROR);

            return CarbonImmutable::parse($payload['receivedAt'])->addHours(8);
        } catch (Throwable) {
            return CarbonImmutable::createFromTimestampUTC(0);
        }
    }

    private function deferBenefits(object $request, object $entry, string $reason): void
    {
        DB::transaction(function () use ($request, $entry, $reason): void {
            $current = DB::table('edna_intake_requests')->where('id', $request->id)->lockForUpdate()->first();
            if (! $current || $current->state !== 'pending') {
                return;
            }
            $expires = $this->benefitsDeadline($entry);
            if ($expires->lte(now())) {
                DB::table('edna_intake_requests')->where('id', $current->id)->where('state', 'pending')->update([
                    'state' => 'review', 'reason' => 'benefits_preflight_expired', 'updated_at' => now(),
                ]);

                return;
            }
            // One pre-POST retry per 30-second window. Another active worker
            // cannot turn processing/unknown into pending or enqueue a second copy.
            if (str_starts_with((string) $current->reason, 'benefits_wait:')
                && CarbonImmutable::parse($current->updated_at)->gt(now()->subSeconds(30))) {
                return;
            }
            $changed = DB::table('edna_intake_requests')->where('id', $current->id)->where('state', 'pending')
                ->where('updated_at', $current->updated_at)->update([
                    'reason' => substr('benefits_wait:'.$reason, 0, 80), 'updated_at' => now(),
                ]);
            if ($changed) {
                $delay = min(random_int(30, 60), max(1, (int) now()->diffInSeconds($expires, false)));
                Queue::connection('edna')->later($delay, new ProcessEdnaIntake((int) $current->id), '', 'edna');
            }
        });
    }
}
