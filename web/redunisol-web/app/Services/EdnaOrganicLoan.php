<?php

namespace App\Services;

use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\SubmitEdnaOrganicLoan;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** A loan inquiry with either a fresh declaration or a real, separately recorded V3 send. */
class EdnaOrganicLoan
{
    public const CONTRACT = 'organic-profile-reuse-v1';

    /** Checked with the same recipient lock used to reserve v3, including across distinct chats. */
    public static function competingReuse(string $subject, string $phone, int $entryId, CarbonImmutable $requestedAt): bool
    {
        $phoneHash = (new AttributionJourney)->phoneHash($phone);

        return ! $phoneHash || DB::table('edna_organic_menus')->where('subject_id', $subject)->where('phone_hash', $phoneHash)
            ->where('entry_event_id', '!=', $entryId)->whereNotNull('case_id')
            ->where(fn ($q) => $q->whereIn('state', ['submitting', 'loan_unknown'])
                ->orWhere('reuse_completed_at', '>=', $requestedAt->utc()))->exists();
    }

    private EdnaOrganicProfile $profiles;

    private EdnaOrganicAttention $attention;

    public function __construct(?EdnaOrganicProfile $profiles = null, ?EdnaOrganicAttention $attention = null)
    {
        $this->profiles = $profiles ?? new EdnaOrganicProfile;
        $this->attention = $attention ?? new EdnaOrganicAttention;
    }

    /** Local only; the menu worker can call this atomically with its selected intent. */
    public function enqueue(int $menuId): bool
    {
        return DB::transaction(function () use ($menuId): bool {
            $menu = DB::table('edna_organic_menus')->where('id', $menuId)->lockForUpdate()->first();
            if (! $menu || ! in_array($menu->state, ['loan_pending', 'submission_pending', 'fallback_pending'], true)
                || ($menu->lease_until && CarbonImmutable::parse($menu->lease_until)->isFuture())
                || ($menu->available_at && CarbonImmutable::parse($menu->available_at)->isFuture())
                || ($menu->enqueued_at && CarbonImmutable::parse($menu->enqueued_at)->gt(now()->subMinute()))) {
                return false;
            }
            $pushed = app(EdnaWorkQueue::class)->push($menu->state === 'submission_pending' ? new SubmitEdnaOrganicLoan($menuId) : new PrepareEdnaOrganicLoan($menuId));
            if ($pushed) {
                DB::table('edna_organic_menus')->where('id', $menuId)->update(['enqueued_at' => now(), 'updated_at' => now()]);
            }

            return $pushed;
        });
    }

    public function prepare(int $menuId): void
    {
        $menu = $this->claim($menuId, 'loan_pending') ?? $this->claim($menuId, 'fallback_pending');
        if (! $menu) {
            return;
        }
        try {
            $paid = $menu->send_state === 'paid_profile' && $menu->paid_entry_routing !== null;
            if ($paid && ! config('edna.intake_crm_enabled') && config('edna.enabled') && config('edna.router_enabled') && config('edna.intake_enabled')) {
                // The borrowing channel can accept a declaration while CRM processing is paused.
                $this->fallback($menu, 'paid_profile_processing_disabled');

                return;
            }
            if (! $this->enabled($paid) || (! $paid && ($menu->choice !== 'loan' || $menu->send_state !== 'confirmed'))) {
                $this->finish($menu, 'preserved', 'organic_loan_disabled');

                return;
            }
            if ($menu->state === 'fallback_pending') {
                $this->fallback($menu, 'profile_requires_fresh_confirmation');

                return;
            }
            $proof = json_decode($menu->proof, true, 16, JSON_THROW_ON_ERROR);
            if ($this->preserveBenefits($menu, $proof)) {
                return;
            }
            $attention = $this->attention->inspectWelcome($proof);
            if (($attention['status'] ?? '') !== 'ready') {
                $this->finish($menu, $attention['status'] === 'waiting' ? 'loan_pending' : 'preserved', $attention['reason']);

                return;
            }
            if ($this->preserveWebContext($menu, $proof)) {
                return;
            }
            $snapshot = $this->attention->snapshot($proof);
            $proof['contact_id'] = ($snapshot['dialog_tuple']['bindings']['contact'] ?? null) ?: null;
            $preferFresh = $paid || app(EdnaFreshIntake::class)->declaration($menu);
            $profile = $this->profiles->resolve($menu, $proof, $preferFresh);
            if (($profile['status'] ?? '') === 'pending') {
                $this->finish($menu, $menu->attempts >= 12 ? 'review' : 'loan_pending', $profile['reason']);

                return;
            }
            if (in_array($profile['status'] ?? '', ['ambiguous', 'missing'], true)) {
                $this->fallback($menu, $profile['reason'] ?? 'profile_requires_confirmation');

                return;
            }
            if (($profile['status'] ?? '') !== 'reusable') {
                $this->finish($menu, 'preserved', $profile['reason'] ?? 'profile_entry_unverified');

                return;
            }
            // Resolve fresh native relationships; a profile's old lead is provenance,
            // never the target to overwrite for this new customer inquiry.
            $contactId = $snapshot['dialog_tuple']['bindings']['contact'] ?? null;
            $binding = $proof;
            $binding['contact_id'] = $contactId ?: null;
            $binding['native_lead_id'] = $proof['native_lead_id'] ?? null;
            if (! $binding['native_lead_id'] && ! $binding['contact_id']) {
                if ($preferFresh) {
                    $this->fallback($menu, 'organic_native_crm_identity_unavailable');
                } else {
                    $this->finish($menu, 'review', 'organic_native_crm_identity_unavailable');
                }

                return;
            }
            $this->finish($menu, 'submission_pending', 'recent_profile_ready', [
                'profile_snapshot' => Crypt::encryptString(json_encode($profile['answer'], JSON_THROW_ON_ERROR)),
                'profile_evidence' => json_encode(['provenance' => $profile['provenance'], 'crm_binding' => $binding,
                    'native_snapshot' => $snapshot, 'fresh_declaration' => $preferFresh], JSON_THROW_ON_ERROR),
                'case_id' => $menu->request_id, 'available_at' => now(), 'enqueued_at' => null,
            ]);
            $this->enqueue($menuId);
        } catch (Throwable) {
            $this->finish($menu, $menu->attempts >= 12 ? 'review' : ($menu->state === 'fallback_pending' ? 'fallback_pending' : 'loan_pending'), 'organic_profile_preparation_pending');
        }
    }

    public function submit(int $menuId): void
    {
        $startedAt = microtime(true);
        $menu = $this->claim($menuId, 'submission_pending');
        if (! $menu) {
            return;
        }
        $lock = null;
        $started = false;
        try {
            $paid = $menu->send_state === 'paid_profile' && $menu->paid_entry_routing !== null;
            if (! $this->enabled($paid) || ! $menu->profile_snapshot || ! $menu->profile_evidence) {
                $this->finish($menu, 'review', 'organic_reuse_disabled_or_unavailable');

                return;
            }
            $url = (string) config('edna.intake_processing_url');
            if (parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)
                || ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_intake/')) {
                $this->finish($menu, 'review', 'organic_reuse_endpoint_unavailable');

                return;
            }
            $proof = json_decode($menu->proof, true, 16, JSON_THROW_ON_ERROR);
            if ($this->preserveBenefits($menu, $proof)) {
                return;
            }
            $store = Cache::getStore();
            if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
                $this->finish($menu, 'submission_pending', 'shared_chat_lock_unavailable');

                return;
            }
            $lock = Cache::lock('web-form-chat:'.$proof['chat_id'], 120, $menu->lease_token);
            if (! $lock->get()) {
                $this->finish($menu, 'submission_pending', 'chat_routing_in_progress');

                return;
            }
            $attention = $this->attention->inspectWelcome($proof);
            if (($attention['status'] ?? '') !== 'ready') {
                $this->finish($menu, $attention['status'] === 'waiting' ? 'submission_pending' : 'preserved', $attention['reason']);

                return;
            }
            $entry = DB::table('edna_incoming_events')->find($menu->entry_event_id);
            $intent = $paid ? $entry : DB::table('edna_incoming_events')->find($menu->choice_event_id);
            $payload = json_decode(Crypt::decryptString($entry->payload), true, 32, JSON_THROW_ON_ERROR);
            $intentPayload = $paid ? $payload : json_decode(Crypt::decryptString($intent->payload), true, 32, JSON_THROW_ON_ERROR);
            $marker = $paid ? app(EdnaPaidEntry::class)->currentMarker($entry, $payload, $menu->paid_entry_routing) : null;
            if ($paid && ! $marker) {
                $this->finish($menu, 'review', 'paid_entry_evidence_changed');

                return;
            }
            $evidence = json_decode($menu->profile_evidence, true, 16, JSON_THROW_ON_ERROR);
            $preferFresh = ($evidence['fresh_declaration'] ?? false) === true;
            $phone = Crypt::decryptString($menu->recipient);
            if (CarbonImmutable::parse($menu->expires_at)->lte(now())) {
                $this->finish($menu, 'expired', 'conversation_window_elapsed');

                return;
            }
            $answer = json_decode(Crypt::decryptString($menu->profile_snapshot), true, 32, JSON_THROW_ON_ERROR);
            $snapshot = $this->attention->snapshot($proof);
            if (! is_string($evidence['native_snapshot']['fingerprint'] ?? null)
                || ! is_string($snapshot['fingerprint'] ?? null)
                || ! hash_equals($evidence['native_snapshot']['fingerprint'], $snapshot['fingerprint'])
                || ! $this->profiles->stillCurrent($menu, $answer, $evidence['provenance'], $snapshot, $preferFresh)) {
                $this->finish($menu, 'loan_pending', 'profile_or_native_identity_changed');

                return;
            }
            if (! hash_equals($phone, (string) ($payload['subscriber']['identifier'] ?? ''))
                || ! hash_equals($phone, (string) ($intentPayload['subscriber']['identifier'] ?? ''))
                || $menu->subject_id !== (string) ($payload['subjectId'] ?? '')
                || $menu->subject_id !== (string) ($intentPayload['subjectId'] ?? '')
                || (string) $entry->message_id !== (string) ($payload['id'] ?? '')
                || (string) $intent->message_id !== (string) ($intentPayload['id'] ?? '')) {
                $this->finish($menu, 'review', 'organic_reuse_entry_changed');

                return;
            }
            $frozen = (new EdnaIntake)->freezeEntryAttribution($entry, $payload,
                (new AttributionJourney)->bind((string) ($payload['messageContent']['text'] ?? ''), $phone, $menu->subject_id), (string) (new EdnaIntake)->flowId());
            $attribution = $frozen['snapshot'];
            if ($marker) {
                if ($marker['evidence']['kind'] === 'tracked_paid_click'
                    && (($attribution['status'] ?? '') !== 'resolved' || $marker['evidence']['journey_id'] !== ($attribution['journey_id'] ?? null))) {
                    $this->finish($menu, 'review', 'paid_attribution_unavailable');

                    return;
                }
                $attribution['entry_routing'] = array_replace($marker, ['route' => 'paid_profile_reuse']);
            }
            unset($attribution['wa']['WA_FLOW_ID']);
            $attribution['wa']['WA_FLOW'] = 'organic_profile_reuse';
            $body = ['contract' => self::CONTRACT, 'case_id' => $menu->request_id, 'phone' => $phone, 'dry_run' => false,
                'received_at' => CarbonImmutable::parse($intentPayload['receivedAt'])->toIso8601String(),
                'answer' => $answer,
                'provenance' => $evidence['provenance'], 'crm_binding' => $evidence['crm_binding'], 'attribution' => $attribution,
                'entry_context' => ['version' => 1, 'source' => 'edna_authenticated', 'event_id' => (int) $entry->id,
                    'message_id' => $entry->message_id, 'subject_id' => $menu->subject_id,
                    'received_at' => CarbonImmutable::parse($payload['receivedAt'])->toIso8601String(), 'origin' => $frozen['origin']]];
            if (app(WebChatContinuity::class)->eligibleEntry($entry)) {
                $body['routing_policy'] = WebChatContinuity::NAME;
                if (empty($body['crm_binding']['native_lead_id']) && ! empty($body['crm_binding']['contact_id'])
                    && app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::CONTACT_DEAL)) {
                    $body['contact_deal_activity'] = true;
                }
            }
            if (microtime(true) - $startedAt > 45) {
                $this->finish($menu, 'submission_pending', 'organic_preflight_budget_elapsed');

                return;
            }
            if ($this->preserveBenefits($menu, $proof)) {
                return;
            }
            $finalAttention = $this->attention->inspectWelcome($proof);
            if (($finalAttention['status'] ?? '') !== 'ready'
                || (string) ($finalAttention['owner_id'] ?? '') !== (string) ($attention['owner_id'] ?? '')
                || (string) ($finalAttention['session_id'] ?? '') !== (string) ($attention['session_id'] ?? '')) {
                $this->finish($menu, ($finalAttention['status'] ?? '') === 'waiting' ? 'submission_pending' : 'preserved',
                    $finalAttention['reason'] ?? 'attention_changed_before_business_request');

                return;
            }
            // Serialize the local check and claim with reference capture, then
            // release the recipient lock before the one application POST.
            $claim = function () use ($menu, $proof, $entry, $intentPayload, $phone, $paid): bool {
                if ($this->preserveWebContext($menu, $proof)) {
                    return false;
                }
                if (app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::V3_VALIDITY)) {
                    $requestedAt = CarbonImmutable::parse($intentPayload['receivedAt'])->min(now());
                    $router = app(EdnaFlowRouter::class);
                    $router->lockRecipient($menu->subject_id, $phone);
                    if ($router->hasBlockingV3($menu->subject_id, $phone, $requestedAt)
                        || self::competingReuse($menu->subject_id, $phone, (int) $entry->id, $requestedAt)) {
                        $this->finish($menu, 'preserved', 'existing_flow_or_context_preserved');

                        return false;
                    }
                    if ($paid) {
                        $intake = app(EdnaIntake::class);
                        $admission = $intake->admit($menu->subject_id, $phone, null, $requestedAt, true);
                        if (! $admission || $admission->flow_id !== $intake->flowId()) {
                            $this->finish($menu, 'preserved', 'paid_intake_admission_unavailable');

                            return false;
                        }
                    }
                }
                $this->update($menu, ['state' => 'submitting', 'reason' => 'organic_reuse_request_started']);

                return true;
            };
            $claimed = app(WebChatContinuity::class)->eligibleEntry($entry)
                ? app(WebFormReceipt::class)->serialized($menu->phone_hash, $claim) : DB::transaction($claim, 5);
            if (! $claimed) {
                return;
            }
            // Polling never resubmits an uncertain business acknowledgement.
            $started = true;
            $response = Http::asJson()->acceptJson()->connectTimeout(3)->timeout(60)->withoutRedirecting()->post($url, $body);
            $result = $response->json();
            if (! $response->successful() || ! is_array($result) || ($result['ok'] ?? null) !== true
                || ($result['contract'] ?? '') !== self::CONTRACT || ($result['case_id'] ?? '') !== $menu->request_id
                || ! is_bool($result['write_attempted'] ?? null)) {
                throw new RuntimeException('Organic inquiry acknowledgement unavailable.');
            }
            $action = $result['action'] ?? '';
            $completed = app(EdnaFreshIntake::class)->entry($entry, EdnaFreshIntake::V3_VALIDITY)
                ? ['reuse_completed_at' => now()] : [];
            $requestFresh = ($result['request_fresh_profile'] ?? null) === true
                || ($action === 'reused_not_valid' && ($result['reason'] ?? '') === 'current_person_unproven');
            $canFallback = $preferFresh ? $requestFresh && in_array($action, ['reused_not_valid', 'manual_review'], true) : $action === 'reused_not_valid';
            if ($result['write_attempted'] === false && $canFallback) {
                // Persist the acknowledged no-write outcome. A delayed purpose
                // check resumes only this fallback, never the business POST.
                $this->update($menu, ['state' => 'fallback_pending', 'reason' => 'profile_requires_fresh_confirmation',
                    'profile_evidence' => json_encode($evidence + ['result' => array_intersect_key($result,
                        array_flip(['action', 'reason', 'lead_id', 'contact_id', 'deal_id', 'seller_id', 'write_attempted']))], JSON_THROW_ON_ERROR)]);
                $menu->state = 'fallback_pending';
                $this->fallback($menu, 'profile_requires_fresh_confirmation');
            } elseif ($action === 'assigned_case' && $result['write_attempted'] === false
                && preg_match('/^[1-9][0-9]*$/D', (string) ($result['deal_id'] ?? ''))
                && preg_match('/^[1-9][0-9]*$/D', (string) ($result['seller_id'] ?? ''))) {
                $assigned = array_intersect_key($result, array_flip(['deal_id', 'seller_id', 'lead_id', 'contact_id']));
                if (($result['reason'] ?? '') === 'existing_contact_deal') {
                    if (! is_string($result['contact_deal_stage'] ?? null) || $result['contact_deal_stage'] === '') {
                        throw new RuntimeException('Contact deal stage missing from acknowledgement.');
                    }
                    $assigned['contact_deal_stage'] = $result['contact_deal_stage'];
                }
                $assigned['profile_identity_hash'] = (new WebFormReceipt)->identityHash($answer['cuil']);
                $this->finish($menu, 'route_pending', 'existing_commercial_case', ['deal_id' => (string) $result['deal_id'],
                    'seller_id' => (string) $result['seller_id'], 'available_at' => now(), 'enqueued_at' => null,
                    'profile_evidence' => json_encode($evidence + ['assigned_case' => $assigned], JSON_THROW_ON_ERROR)] + $completed);
            } elseif (in_array($action, ['queued', 'already_processed', 'rejected'], true)
                && preg_match('/^[1-9][0-9]*$/D', (string) ($result['lead_id'] ?? ''))) {
                $this->finish($menu, 'loan_submitted', $action, ['profile_evidence' => json_encode($evidence + ['result' => array_intersect_key($result, array_flip(['action', 'lead_id', 'contact_id', 'deal_id', 'seller_id', 'write_attempted']))], JSON_THROW_ON_ERROR)] + $completed);
            } else {
                $this->finish($menu, 'review', 'organic_reuse_'.(in_array($action, ['manual_review', 'disabled'], true) ? $action : 'acknowledgement_invalid'),
                    $result['write_attempted'] ? $completed : []);
            }
        } catch (Throwable) {
            if ($menu->state === 'fallback_pending') {
                $this->finish($menu, 'fallback_pending', 'profile_fallback_pending');
            } else {
                $this->finish($menu, $started ? 'loan_unknown' : 'submission_pending', $started ? 'organic_reuse_result_uncertain' : 'organic_reuse_preflight_pending');
            }
        } finally {
            try {
                $lock?->release();
            } catch (Throwable) {
                // Owner-aware lock expiration cannot replay an external POST.
            }
        }
    }

    private function fallback(object $menu, string $reason): void
    {
        $proof = json_decode($menu->proof, true, 16, JSON_THROW_ON_ERROR);
        if ($this->preserveBenefits($menu, $proof)) {
            return;
        }
        if (CarbonImmutable::parse($menu->expires_at)->lte(now())) {
            $this->finish($menu, 'expired', 'conversation_window_elapsed');

            return;
        }
        $attention = $this->attention->inspectWelcome($proof);
        if (($attention['status'] ?? '') !== 'ready') {
            $this->finish($menu, ($attention['status'] ?? '') === 'waiting' ? 'fallback_pending' : 'preserved',
                $attention['reason'] ?? 'chat_attention_unverified');

            return;
        }
        DB::transaction(function () use ($menu, $reason): void {
            $proof = json_decode($menu->proof, true, 16, JSON_THROW_ON_ERROR);
            if ($this->preserveWebContext($menu, $proof)) {
                return;
            }
            $this->update($menu, ['state' => 'selected', 'reason' => $reason]);
            if ($menu->send_state === 'paid_profile') {
                $entry = DB::table('edna_incoming_events')->where('id', $menu->entry_event_id)->firstOrFail();
                $payload = json_decode(Crypt::decryptString($entry->payload), true, 32, JSON_THROW_ON_ERROR);
                $marker = app(EdnaPaidEntry::class)->currentMarker($entry, $payload, $menu->paid_entry_routing);
                if (! $marker) {
                    $this->finish($menu, 'review', 'paid_entry_evidence_changed');

                    return;
                }
                $sendId = app(EdnaFlowRouter::class)->startPaidEntry($entry, $payload, $marker);
            } else {
                $sendId = app(EdnaFlowRouter::class)->startOrganicChoice((int) $menu->id);
            }
            $this->finish($menu, $sendId ? 'flow_scheduled' : 'preserved', $sendId ? 'new_profile_requested' : 'existing_flow_or_context_preserved',
                $sendId ? ['flow_send_id' => $sendId] : []);
        });
    }

    private function preserveBenefits(object $menu, array $proof): bool
    {
        $entryId = $menu->entry_event_id;
        if ($menu->choice_event_id && is_array($proof['choice_proof'] ?? null)) {
            $entryId = $menu->choice_event_id;
            $proof = $proof['choice_proof'];
        }
        $event = DB::table('edna_incoming_events')->find($entryId);
        if (! $event || ! ($decision = app(EdnaBenefitsRouting::class)->check($event, $proof))) {
            return false;
        }
        $state = match ($decision['state'] ?? '') {
            'waiting' => $menu->state,
            'review' => 'review',
            default => 'preserved',
        };
        $this->finish($menu, $state, $decision['reason'] ?? 'benefits_routing');

        return true;
    }

    private function preserveWebContext(object $menu, array $proof): bool
    {
        $entry = DB::table('edna_incoming_events')->find($menu->entry_event_id);
        if (! $entry || ! app(WebChatContinuity::class)->blocksOutbound($entry, $proof)) {
            return false;
        }
        $this->finish($menu, 'preserved', 'web_continuity_priority');

        return true;
    }

    public function poll(int $limit = 25): int
    {
        DB::table('edna_organic_menus')->where('state', 'submitting')->where('lease_until', '<=', now())
            ->update(['state' => 'loan_unknown', 'reason' => 'organic_reuse_worker_interrupted', 'lease_token' => null,
                'lease_until' => null, 'updated_at' => now()]);
        $queue = app(EdnaWorkQueue::class);
        $ids = DB::table('edna_organic_menus')->where(fn ($query) => $query
            ->where(fn ($prepare) => $queue->withoutPending($prepare->whereIn('state', ['loan_pending', 'fallback_pending']), PrepareEdnaOrganicLoan::class, 'edna_organic_menus.id'))
            ->orWhere(fn ($submit) => $queue->withoutPending($submit->where('state', 'submission_pending'), SubmitEdnaOrganicLoan::class, 'edna_organic_menus.id')))
            ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
            ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
            ->where(fn ($q) => $q->whereNull('enqueued_at')->orWhere('enqueued_at', '<=', now()->subMinute()))
            ->orderBy('available_at')->orderBy('id')->limit($limit)->pluck('id');

        return $ids->sum(fn ($id) => (int) $this->enqueue((int) $id));
    }

    private function enabled(bool $paid): bool
    {
        return config('edna.enabled') && config('edna.router_enabled') && config('edna.intake_enabled')
            && ($paid || config('edna.organic_menu_enabled')) && config('edna.intake_crm_enabled');
    }

    private function claim(int $id, string $state): ?object
    {
        return DB::transaction(function () use ($id, $state) {
            $menu = DB::table('edna_organic_menus')->where('id', $id)->lockForUpdate()->first();
            if (! $menu || $menu->state !== $state || ($menu->lease_until && CarbonImmutable::parse($menu->lease_until)->isFuture())
                || ($menu->available_at && CarbonImmutable::parse($menu->available_at)->isFuture())) {
                return null;
            }
            DB::table('edna_organic_menus')->where('id', $id)->update(['lease_token' => (string) Str::uuid(),
                'lease_until' => now()->addSeconds(120), 'attempts' => $menu->attempts + 1, 'enqueued_at' => null, 'updated_at' => now()]);

            return DB::table('edna_organic_menus')->find($id);
        });
    }

    private function update(object $menu, array $fields): void
    {
        if (DB::table('edna_organic_menus')->where('id', $menu->id)->where('lease_token', $menu->lease_token)
            ->where('lease_until', '>', now())->update($fields + ['updated_at' => now()]) !== 1) {
            throw new RuntimeException('Organic inquiry lease superseded.');
        }
    }

    private function finish(object $menu, string $state, string $reason, array $fields = []): void
    {
        $this->update($menu, $fields + ['state' => $state, 'reason' => $reason,
            'lease_token' => null, 'lease_until' => null, 'available_at' => now()->addMinute(), 'updated_at' => now()]);
        try {
            app(JourneyLedger::class)->record('whatsapp.organic_loan', ['menu_id' => $menu->id, 'state' => $state, 'reason' => $reason],
                ['case_id' => $menu->request_id, 'entry_event_id' => $menu->entry_event_id], 'whatsapp.edna');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) {
            // Business receipts remain primary; a tracking failure never resends.
        }
    }
}
