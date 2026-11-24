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
            $freshInbox = config('edna.sales_inbox_enabled') && $entry && $entry->created_at
                && DB::table('sales_inbox_cursors')->where('line_id', 1)->where('starts_at', '<', $entry->created_at)->exists();
            if ($freshInbox && str_starts_with((string) $request->reason, 'attention_wait:')
                && CarbonImmutable::parse($request->received_at, 'UTC')->addHours(8)->lte(now())) {
                $this->deferPreflight($request, $entry, 'attention_unavailable', 'attention');

                return;
            }
            if ($entry && str_starts_with((string) $request->reason, 'benefits_wait:')
                && $this->benefitsDeadline($entry)->lte(now())) {
                $this->deferPreflight($request, $entry, 'benefits_preflight_expired');

                return;
            }
            $benefits = app(EdnaBenefitsRouting::class);
            $checkBenefits = $entry && $benefits->eligibleEntry($entry);
            if ($checkBenefits && $this->interceptBenefits($request, $entry, $proof, $benefits)) {
                return;
            }
            if (! $checkBenefits && $this->preserveNativeAttention($request, $proof, $freshInbox ? $entry : null)) {
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
                if (app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::ORGANIC_SELLER_WAIT)
                    && $this->organicFlowMenu($send, $proof)) {
                    $body['follow_pending_seller'] = true;
                }
                if (empty($body['crm_binding']['native_lead_id']) && ! empty($body['crm_binding']['contact_id'])
                    && app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::CONTACT_DEAL)) {
                    $body['contact_deal_activity'] = true;
                }
            }
            // This contract revalidates native message, CUIL and existing management in Kestra.
            // The actual Flow transport remains in edna_flow_sends and is never invented/replayed.
            if (($checkBenefits && $this->interceptBenefits($request, $entry, $proof, $benefits))
                || (($checkBenefits || $freshInbox) && $this->preserveNativeAttention($request, $proof, $freshInbox ? $entry : null))) {
                return;
            }
            if (($checkBenefits || $freshInbox) && microtime(true) + 63 >= $deadline) {
                // Do not claim a 60-second business POST when the worker can no
                // longer retain its acknowledgement. All retry work is pre-POST.
                $kind = $checkBenefits ? 'benefits' : 'attention';
                $this->deferPreflight($request, $entry, $kind.'_preflight_budget_elapsed', $kind);

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
            $waiting = ($body['follow_pending_seller'] ?? false) ? EdnaOrganicLoan::waitingCase($result, $answer) : null;
            $synced = $assigned || $waiting !== null || in_array($action, ['queued', 'already_processed', 'rejected'], true);
            if ($synced && ! $assigned && $waiting === null && ! preg_match('/^[1-9][0-9]{0,18}$/D', (string) ($result['lead_id'] ?? ''))) {
                throw new RuntimeException('Fresh intake CRM acknowledgement invalid.');
            }
            DB::transaction(function () use ($request, $send, $proof, $answer, $result, $assigned, $synced, $waiting): void {
                if ($waiting !== null && ($menu = $this->organicFlowMenu($send, $proof, true))) {
                    DB::table('edna_organic_menus')->where('id', $menu->id)->update([
                        'state' => 'seller_wait', 'reason' => 'commercial_seller_not_ready', 'deal_id' => $waiting['deal_id'],
                        'seller_id' => null, 'attempts' => 0, 'available_at' => now()->addMinute(), 'enqueued_at' => null,
                        'profile_snapshot' => $request->answer, 'profile_evidence' => json_encode(['waiting_case' => $waiting,
                            'intake_request_id' => (string) $request->id], JSON_THROW_ON_ERROR), 'updated_at' => now(),
                    ]);
                }
                DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'processing')->update([
                    'state' => $synced ? 'synced' : 'review', 'reason' => $result['reason'] ?? 'native_intake_review',
                    'lead_id' => ($result['lead_id'] ?? null) ?: null, 'contact_id' => ($result['contact_id'] ?? null) ?: null, 'updated_at' => now(),
                ]);
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

    private function organicFlowMenu(object $send, array $proof, bool $lock = false): ?object
    {
        $menu = DB::table('edna_organic_menus')->where('flow_send_id', $send->id)->where('entry_event_id', $send->entry_event_id)
            ->where('subject_id', $send->subject_id)->where('state', 'flow_scheduled')->where('choice', 'loan')
            ->whereIn('send_state', ['confirmed', 'not_needed'])->where('transfer_state', 'pending')->whereNull('transfer_intent')
            ->where('expires_at', '>', now())->when($lock, fn ($q) => $q->lockForUpdate())->first();
        if (! $menu || ($menu->send_state !== 'confirmed' && ! SalesLoanIntent::verified($menu))
            || ! hash_equals(hash_hmac('sha256', 'organic-menu:'.$menu->request_id, (string) config('app.key')), (string) $send->scope)) {
            return null;
        }
        $original = json_decode($menu->proof ?? '', true, 32, JSON_THROW_ON_ERROR);
        $choice = $original['choice_proof'] ?? [];
        if (($original['verified'] ?? false) !== true || ($choice['verified'] ?? false) !== true
            || empty($menu->choice_event_id) || (string) ($choice['entry_event_id'] ?? '') !== (string) $menu->choice_event_id
            || (string) ($choice['chat_id'] ?? '') !== (string) $menu->chat_id
            || (string) ($choice['session_id'] ?? '') !== (string) $menu->session_id
            || (string) ($original['chat_id'] ?? '') !== (string) $menu->chat_id
            || (string) ($original['session_id'] ?? '') !== (string) $menu->session_id) {
            return null;
        }
        foreach (['chat_id', 'session_id', 'message_id', 'activity_id', 'entry_message_id', 'entry_event_id'] as $field) {
            if (empty($proof[$field]) || (string) ($original[$field] ?? '') !== (string) $proof[$field]) {
                return null;
            }
        }

        return $menu;
    }

    private function preserveNativeAttention(object $request, array $proof, ?object $freshEntry): bool
    {
        try {
            $attention = app(EdnaOrganicAttention::class)->inspectWelcome($proof);
        } catch (Throwable) {
            $attention = ['status' => 'waiting', 'reason' => 'native_attention_unavailable'];
        }
        if (($attention['status'] ?? '') === 'waiting' && $freshEntry) {
            $this->deferPreflight($request, $freshEntry, $attention['reason'] ?? 'native_attention_unavailable', 'attention');
            return true;
        }
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
            $this->deferPreflight($request, $entry, (string) ($decision['reason'] ?? 'benefits_evidence_pending'));
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

    private function deferPreflight(object $request, object $entry, string $reason, string $kind = 'benefits'): void
    {
        DB::transaction(function () use ($request, $entry, $reason, $kind): void {
            $current = DB::table('edna_intake_requests')->where('id', $request->id)->lockForUpdate()->first();
            if (! $current || $current->state !== 'pending') {
                return;
            }
            $expires = $kind === 'attention' ? CarbonImmutable::parse($current->received_at, 'UTC')->addHours(8) : $this->benefitsDeadline($entry);
            if ($expires->lte(now())) {
                DB::table('edna_intake_requests')->where('id', $current->id)->where('state', 'pending')->update([
                    'state' => 'review', 'reason' => $kind.'_preflight_expired', 'updated_at' => now(),
                ]);

                return;
            }
            // One pre-POST retry per 30-second window. Another active worker
            // cannot turn processing/unknown into pending or enqueue a second copy.
            if (str_starts_with((string) $current->reason, $kind.'_wait:')
                && CarbonImmutable::parse($current->updated_at)->gt(now()->subSeconds(30))) {
                return;
            }
            $changed = DB::table('edna_intake_requests')->where('id', $current->id)->where('state', 'pending')
                ->where('updated_at', $current->updated_at)->update([
                    'reason' => substr($kind.'_wait:'.$reason, 0, 80), 'updated_at' => now(),
                ]);
            if ($changed) {
                $remaining = max(1, (int) now()->diffInSeconds($expires, false));
                $step = $kind === 'attention' ? min(900, 30 * 2 ** min(5, intdiv(max(0, 28800 - $remaining), 300))) : 30;
                $delay = min(random_int($step, $step * 2), $remaining);
                Queue::connection('edna')->later($delay, new ProcessEdnaIntake((int) $current->id), '', 'edna');
            }
        });
    }
}
