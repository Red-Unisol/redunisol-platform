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

/** Processes an authenticated completed Flow and retains its exact native session. */
class EdnaNativeIntake
{
    public function process(object $request, object $send, array $proof): void
    {
        $deadline = microtime(true) + 105;
        $fresh = app(EdnaFreshIntake::class)->declaration($send);
        if ($request->state !== 'pending' || ! app(EdnaFreshIntake::class)->applies($send)
            || ! in_array($proof['version'] ?? null, $fresh ? [1, 2] : [2], true)
            || $send->state !== 'completed' || (int) $send->response_event_id !== (int) $request->response_event_id
            || (int) $send->id !== (int) $request->flow_send_id
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
            if (! $fresh && ! $checkBenefits && $this->preserveNativeAttention($request, $proof)) {
                return;
            }
            $service = new EdnaIntake;
            $attribution = $service->attribution($send);
            $context = $service->entryContext($send);
            if (! $attribution || ! $context) {
                throw new RuntimeException('Fresh intake context unavailable.');
            }
            $contract = $fresh ? EdnaFreshIntake::DECLARATION : EdnaOrganicLoan::CONTRACT;
            if (! $fresh) {
                unset($attribution['wa']['WA_FLOW_ID']);
                $attribution['wa']['WA_FLOW'] = 'organic_profile_reuse';
            }
            $answer = json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR);
            $body = ['contract' => $contract, 'case_id' => $send->request_id,
                'phone' => Crypt::decryptString($send->recipient), 'dry_run' => false,
                'received_at' => CarbonImmutable::parse($request->received_at)->toIso8601String(), 'answer' => $answer,
                'entry_context' => $context, 'crm_binding' => array_replace($proof, ['version' => 1]), 'attribution' => $attribution,
                'provenance' => ['source_kind' => 'edna_intake_request', 'source_id' => (string) $request->id,
                    'schema' => 'whatsapp-intake-v3', 'v3_equivalent' => true,
                    'confirmed_at' => CarbonImmutable::parse($request->received_at)->toIso8601String()]];
            if ($fresh) {
                if ($entry && app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::OWNERSHIP)) {
                    $body['chat_ownership_request_id'] = $send->request_id;
                }
                $event = DB::table('edna_incoming_events')->find($request->response_event_id);
                $payload = $event ? json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR) : null;
                $transport = app(EdnaFlowTransport::class)->id($send);
                $original = json_decode((string) ($payload['messageContent']['text'] ?? ''), true, 16, JSON_THROW_ON_ERROR);
                if (! $event || $event->subject_id !== $send->subject_id || ($payload['id'] ?? null) !== $event->message_id
                    || ($payload['subjectId'] ?? null) !== $send->subject_id || ($payload['subscriber']['identifier'] ?? null) !== $body['phone']
                    || ($payload['messageContent']['type'] ?? null) !== 'FLOW' || ($payload['replyOutMessageExternalRequestId'] ?? null) !== $transport
                    || ! $send->outgoing_message_id || (string) ($payload['replyOutMessageId'] ?? '') !== $send->outgoing_message_id
                    || $original !== $answer || empty($payload['receivedAt'])
                    || CarbonImmutable::parse($payload['receivedAt'])->timestamp !== CarbonImmutable::parse($request->received_at)->timestamp
                    || app(EdnaIntakeBinding::class)->verified($send) !== $proof) {
                    throw new RuntimeException('Completed Flow evidence does not match this application.');
                }
                unset($body['provenance']);
                $body['flow_id'] = $send->flow_id;
                $body['response'] = ['request_id' => (string) $request->id, 'case_id' => $send->request_id,
                    'transport_id' => $transport, 'outgoing_message_id' => $send->outgoing_message_id,
                    'event_id' => (int) $event->id, 'message_id' => $event->message_id];
                try {
                    $receipt = app(WebChatContinuity::class)->declarationReceipt($send, $request, $proof, $answer);
                } catch (Throwable) {
                    $this->deferBenefits($request, $entry, 'web_reference_confirmation_pending', 'declaration_wait:');

                    return;
                }
                if ($receipt) {
                    DB::transaction(function () use ($request, $receipt): void {
                        $current = DB::table('web_form_receipts')->where('id', $receipt->id)->lockForUpdate()->first();
                        if (! $current || $current->state !== 'synced' || $current->source !== 'web_server'
                            || $current->identity_hash !== $receipt->identity_hash || $current->phone_hash !== $receipt->phone_hash
                            || $current->lead_id !== $receipt->lead_id || $current->contact_id !== $receipt->contact_id
                            || $current->reference_hash !== $receipt->reference_hash) {
                            throw new RuntimeException('Referenced commercial request changed.');
                        }
                        $claimed = DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')->update([
                            'state' => 'pending_requalification', 'reason' => 'fresh_web_revision',
                            'web_submission_id' => $receipt->id, 'lead_id' => $receipt->lead_id,
                            'contact_id' => $receipt->contact_id, 'updated_at' => now(),
                        ]);
                        if ($claimed) {
                            \App\Jobs\RequalifyEdnaWebDeclaration::dispatch((int) $request->id)->onConnection('edna')->onQueue('edna')->afterCommit();
                        }
                    });

                    return;
                }
                if (! $checkBenefits && $this->preserveNativeAttention($request, $proof)) {
                    return;
                }
            }
            $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
            if ($entry && app(WebChatContinuity::class)->eligibleEntry($entry)) {
                $body['routing_policy'] = WebChatContinuity::NAME;
                if (empty($body['crm_binding']['native_lead_id']) && ! empty($body['crm_binding']['contact_id'])
                    && app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::CONTACT_DEAL)) {
                    $body['contact_deal_activity'] = true;
                }
            }
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
                || ($result['contract'] ?? '') !== $contract || ($result['case_id'] ?? '') !== $send->request_id
                || ! is_bool($result['write_attempted'] ?? null)) {
                throw new RuntimeException('Fresh intake acknowledgement uncertain.');
            }
            $action = $result['action'] ?? '';
            if ($fresh && $action === 'manual_review' && $result['write_attempted'] === false
                && in_array($result['reason'] ?? '', ['original_guest_ownership_unverified', 'attention_inspection_unavailable', 'native_history_incomplete'], true)) {
                DB::transaction(function () use ($request, $entry, $result): void {
                    if (DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'processing')
                        ->update(['state' => 'pending', 'reason' => null, 'updated_at' => now()])) {
                        $this->deferBenefits($request, $entry, $result['reason'], 'declaration_wait:');
                    }
                });

                return;
            }
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
            DB::transaction(function () use ($request, $proof, $answer, $result, $assigned, $synced, $fresh, $send): void {
                DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'processing')->update([
                    'state' => $synced ? 'synced' : 'review', 'reason' => $result['reason'] ?? 'native_intake_review',
                    'lead_id' => ($result['lead_id'] ?? null) ?: null, 'contact_id' => ($result['contact_id'] ?? null) ?: null, 'updated_at' => now(),
                ]);
                $case = null;
                if ($assigned) {
                    $case = array_intersect_key($result, array_flip(['lead_id', 'contact_id', 'deal_id', 'seller_id']));
                    if (($result['reason'] ?? '') === 'existing_contact_deal') {
                        if (! is_string($result['contact_deal_stage'] ?? null) || $result['contact_deal_stage'] === '') {
                            throw new RuntimeException('Contact deal stage missing from acknowledgement.');
                        }
                        $case['contact_deal_stage'] = $result['contact_deal_stage'];
                    }
                    $case['identity_hash'] = (new WebFormReceipt)->identityHash($answer['cuil'] ?? '');
                    if (! $case['identity_hash']) {
                        throw new RuntimeException('Assigned case identity unavailable.');
                    }
                } elseif ($fresh && in_array($result['action'], ['queued', 'already_processed'], true)) {
                    $case = ['request_uuid' => $send->request_id, 'lead_id' => (string) $result['lead_id'],
                        'identity_hash' => (new WebFormReceipt)->identityHash($answer['cuil'] ?? '')];
                }
                if ($case !== null && DB::table('edna_intake_chat_routes')->insertOrIgnore([
                    'request_id' => $request->id, 'proof' => json_encode($proof, JSON_THROW_ON_ERROR),
                    'assigned_case' => json_encode($case, JSON_THROW_ON_ERROR), 'state' => 'pending',
                    'created_at' => now(), 'updated_at' => now(),
                ])) {
                    Queue::connection('edna')->push(new RouteEdnaIntakeChat((int) $request->id), '', 'edna');
                }
            });
            if ($synced) {
                try {
                    app(EdnaOrganicProfile::class)->record('edna_intake_request', (string) $request->id, $body['phone'],
                        $answer, $request->received_at, ($result['lead_id'] ?? null) ?: null, ($result['contact_id'] ?? null) ?: null, (string) $send->flow_id);
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

    private function deferBenefits(object $request, object $entry, string $reason, string $prefix = 'benefits_wait:'): void
    {
        DB::transaction(function () use ($request, $entry, $reason, $prefix): void {
            $current = DB::table('edna_intake_requests')->where('id', $request->id)->lockForUpdate()->first();
            if (! $current || $current->state !== 'pending') {
                return;
            }
            $expires = $this->benefitsDeadline($entry);
            if ($expires->lte(now())) {
                DB::table('edna_intake_requests')->where('id', $current->id)->where('state', 'pending')->update([
                    'state' => 'review', 'reason' => $prefix === 'benefits_wait:' ? 'benefits_preflight_expired' : 'web_reference_confirmation_expired',
                    'updated_at' => now(),
                ]);

                return;
            }
            // One pre-POST retry per 30-second window. Another active worker
            // cannot turn processing/unknown into pending or enqueue a second copy.
            if (str_starts_with((string) $current->reason, $prefix)
                && CarbonImmutable::parse($current->updated_at)->gt(now()->subSeconds(30))) {
                return;
            }
            $changed = DB::table('edna_intake_requests')->where('id', $current->id)->where('state', 'pending')
                ->where('updated_at', $current->updated_at)->update([
                    'reason' => substr($prefix.$reason, 0, 80), 'updated_at' => now(),
                ]);
            if ($changed) {
                $maxDelay = $prefix === 'declaration_wait:' ? max(60, min(1800, (int) CarbonImmutable::parse($request->received_at)->diffInSeconds(now()))) : 60;
                $delay = min(random_int(30, $maxDelay), max(1, (int) now()->diffInSeconds($expires, false)));
                Queue::connection('edna')->later($delay, new ProcessEdnaIntake((int) $current->id), '', 'edna');
            }
        });
    }
}
