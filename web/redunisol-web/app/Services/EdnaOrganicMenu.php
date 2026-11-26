<?php

namespace App\Services;

use App\Jobs\ProcessEdnaOrganicMenu;
use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Durable organic intake: authenticated inbox capture, then bounded provider work. */
class EdnaOrganicMenu
{
    private EdnaBitrix $crm;

    private EdnaMessageBinding $binding;

    private EdnaOrganicTransport $transport;

    private EdnaOrganicAttention $attention;

    private int $menuId;

    private string $token;

    private float $deadline;

    private ?Lock $chatLock = null;

    public function __construct(?EdnaBitrix $crm = null, ?EdnaMessageBinding $binding = null,
        ?EdnaOrganicTransport $transport = null, ?EdnaOrganicAttention $attention = null)
    {
        $this->crm = $crm ?? app(EdnaBitrix::class);
        $this->binding = $binding ?? app(EdnaMessageBinding::class);
        $this->transport = $transport ?? app(EdnaOrganicTransport::class);
        $this->attention = $attention ?? app(EdnaOrganicAttention::class);
    }

    // Runs inside the inbox transaction. A token is an action, never a new entry.
    public function receiveChoice(object $event, array $payload): bool
    {
        return DB::transaction(fn () => $this->captureChoice($event, $payload));
    }

    private function captureChoice(object $event, array $payload): bool
    {
        $raw = $payload['messageContent']['payload'] ?? null;
        $reply = $payload['replyOutMessageExternalRequestId'] ?? null;
        $knownReply = is_string($reply) && Str::isUuid($reply)
            && DB::table('edna_organic_menus')->where('request_id', $reply)->exists();
        if ((! is_string($raw) || ! str_starts_with($raw, 'organic:')) && ! $knownReply) {
            return false;
        }
        $stored = $this->authenticatedPayload($event, $payload);
        $choice = $stored ? EdnaOrganicTransport::parseChoice($stored['messageContent']['payload'] ?? null) : null;
        if (! $choice || ($stored['messageContent']['type'] ?? '') === 'FLOW') {
            $this->record($event->id, 'organic_choice_unmatched');

            return true;
        }
        $menu = DB::table('edna_organic_menus')->where('request_id', $choice['request_id'])->lockForUpdate()->first();
        if (! $menu || $menu->form_consent !== null || ! $this->matchesChoice($menu, $event, $stored, false)
            || in_array($menu->state, ['duplicate', 'review', 'preserved', 'expired'], true)) {
            $this->record($event->id, 'organic_choice_unmatched');

            return true;
        }
        if ($menu->choice_event_id) {
            $this->record($event->id, (int) $menu->choice_event_id === (int) $event->id
                ? 'organic_choice_received' : 'organic_choice_duplicate');

            return true;
        }
        $claimed = DB::table('edna_organic_menus')->where('id', $menu->id)->whereNull('choice_event_id')->update([
            'choice_event_id' => $event->id, 'choice' => $choice['choice'],
            'choice_received_at' => CarbonImmutable::parse($stored['receivedAt']),
            'state' => 'selected', 'available_at' => now(), 'enqueued_at' => now(), 'updated_at' => now(),
        ]);
        if ($claimed) {
            app(EdnaWorkQueue::class)->push(new ProcessEdnaOrganicMenu((int) $menu->id));
        }
        $this->record($event->id, 'organic_choice_received');

        return true;
    }

    // Called only after explicit web continuations and proven reentries had priority.
    public function receiveEntry(object $event, array $payload): bool
    {
        return DB::transaction(fn () => $this->captureEntry($event, $payload));
    }

    /** Only reserve locally here. Provider reads belong to the durable worker. */
    public function receiveConsentCandidate(object $event, array $payload): bool
    {
        if (! app(EdnaFormConsent::class)->candidate($payload)
            || ! app(EdnaFreshIntake::class)->entry($event, 'form-consent-v1')) {
            return false;
        }

        return DB::transaction(fn () => $this->captureEntry($event, $payload, 'verify_consent'));
    }

    public function receiveMemberBenefitsCandidate(object $event, array $payload): bool
    {
        if (! app(EdnaMemberBenefitsButton::class)->candidate($payload)
            || ! app(EdnaFreshIntake::class)->entry($event, EdnaMemberBenefitsButton::CUTOVER)) {
            return false;
        }

        return DB::transaction(fn () => $this->captureEntry($event, $payload, 'verify_benefits'));
    }

    public function receiveCampaignCandidate(object $event, array $payload): bool
    {
        if (! app(EdnaCampaignTemplate::class)->candidate($payload)
            || ! app(EdnaFreshIntake::class)->entry($event, EdnaCampaignTemplate::CUTOVER)) {
            return false;
        }
        $reply = $payload['replyOutMessageExternalRequestId'] ?? '';
        if (is_string($reply) && Str::isUuid($reply)
            && DB::table('edna_organic_menus')->where('request_id', $reply)->exists()) {
            return false;
        }

        return DB::transaction(fn () => $this->captureEntry($event, $payload, 'verify_campaign'));
    }

    private function captureEntry(object $event, array $payload, string $sendState = 'pending'): bool
    {
        $stored = $this->authenticatedPayload($event, $payload);
        $ordinary = $sendState === 'pending';
        $quoted = in_array($sendState, ['verify_consent', 'verify_campaign'], true);
        if (! $stored || ! $this->eligible($event, $stored, $ordinary)
            || ($sendState === 'verify_campaign' && ! app(EdnaCampaignTemplate::class)->candidate($stored))
            || ($ordinary && app(EdnaPaidEntry::class)->classify($event, $stored))) {
            return false;
        }
        if ($ordinary && app(WebChatContinuity::class)->receive($event, $stored)) {
            $this->record($event->id, 'web_form_continuation');

            return true;
        }
        $received = CarbonImmutable::parse($stored['receivedAt']);
        $phone = $stored['subscriber']['identifier'];
        $inserted = DB::table('edna_organic_menus')->insertOrIgnore([
            'request_id' => (string) Str::uuid(), 'entry_event_id' => $event->id,
            'subject_id' => $event->subject_id, 'cascade_id' => (string) config('edna.cascade_id'),
            'phone_hash' => (new AttributionJourney)->phoneHash($phone), 'recipient' => Crypt::encryptString($phone),
            'state' => $quoted ? 'consent_pending' : 'pending', 'send_state' => $sendState,
            'transfer_state' => 'pending',
            'entry_received_at' => $received, 'expires_at' => $received->addHours(24),
            'available_at' => now(), 'enqueued_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ] + ($quoted ? ['form_consent' => json_encode(['entry_event_id' => (int) $event->id,
            'reply_out_message_id' => (string) $stored['replyOutMessageId'], 'received_at' => $stored['receivedAt']],
            JSON_THROW_ON_ERROR)] : []));
        if ($inserted) {
            $id = DB::table('edna_organic_menus')->where('entry_event_id', $event->id)->value('id');
            app(EdnaWorkQueue::class)->push(new ProcessEdnaOrganicMenu((int) $id));
        }
        $this->record($event->id, match ($sendState) {
            'verify_campaign' => 'campaign_reply_verification',
            'verify_benefits' => 'member_benefits_verification',
            'verify_consent' => 'form_consent_verification',
            default => 'organic_menu_reserved',
        });

        return true;
    }

    public function poll(int $limit = 25): int
    {
        $limit = max(1, min(25, $limit));

        return DB::transaction(function () use ($limit): int {
            $queue = app(EdnaWorkQueue::class);
            $rows = $queue->withoutPending(DB::table('edna_organic_menus'), ProcessEdnaOrganicMenu::class, 'edna_organic_menus.id')
                ->where(function ($query): void {
                    $query->whereIn('state', ['pending', 'consent_pending', 'waiting', 'selected', 'unknown', 'route_pending'])
                        ->orWhere(fn ($q) => $q->where('state', 'awaiting_choice')->where(fn ($choice) => $choice
                            ->whereNotNull('choice_event_id')->orWhere('expires_at', '<=', now())));
                })->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->where(fn ($q) => $q->whereNull('enqueued_at')->orWhere('enqueued_at', '<=', now()->subMinute()))
                ->orderByRaw('COALESCE(available_at, created_at)')->orderBy('id')->limit($limit)->lockForUpdate()->get();
            $enqueued = 0;
            foreach ($rows as $row) {
                if ($queue->push(new ProcessEdnaOrganicMenu((int) $row->id))) {
                    DB::table('edna_organic_menus')->where('id', $row->id)->update(['enqueued_at' => now(), 'updated_at' => now()]);
                    $enqueued++;
                }
            }

            return $enqueued;
        });
    }

    public function process(int $menuId): array
    {
        $this->menuId = $menuId;
        $this->deadline = microtime(true) + 90;
        $this->chatLock = null;
        $menu = $this->claim();
        if (! $menu) {
            return ['state' => 'not_claimed'];
        }
        $this->token = $menu->lease_token;
        try {
            $consent = $menu->form_consent ? json_decode($menu->form_consent, true, 32, JSON_THROW_ON_ERROR) : null;
            $event = DB::table('edna_incoming_events')->find($consent['entry_event_id'] ?? $menu->entry_event_id);
            $payload = $event ? $this->authenticatedPayload($event) : null;
            if (! $payload || ! $this->matchesMenu($menu, $event, $payload)) {
                return $this->finish('review', 'authenticated_entry_unavailable');
            }
            $uncertainTransfer = in_array($menu->transfer_state, ['sending', 'unknown'], true);
            $uncertainSend = in_array($menu->send_state, ['sending', 'accepted', 'unknown'], true);
            if (! $uncertainTransfer && ! $uncertainSend && ! $this->eligible($event, $payload, false)) {
                return $this->finish('waiting', 'organic_menu_disabled_or_outside_pilot');
            }
            if ($consent !== null && ! $uncertainTransfer && CarbonImmutable::parse($menu->expires_at)->lte(now())) {
                return $this->finish('expired', 'form_consent_window_elapsed');
            }
            if ($consent !== null && ! isset($consent['choice'])) {
                $verified = $menu->send_state === 'verify_campaign'
                    ? app(EdnaCampaignTemplate::class)->verifiedReply($payload)
                    : app(EdnaFormConsent::class)->verifiedReply($payload);
                if ($verified !== null) {
                    $consent += $verified;
                    $consent['choice'] ??= in_array($verified['action'], ['decline', 'defer', 'unsubscribe'], true) ? 'no' : 'received';
                    $this->write(['form_consent' => json_encode($consent, JSON_THROW_ON_ERROR), 'send_state' => 'not_needed']);
                } else {
                    // An unrelated template can use the same labels. Restore normal channel precedence.
                    if (app(WebFormContinuation::class)->receive($event, $payload)) {
                        return $this->finish('preserved', 'web_continuity_priority', ['form_consent' => null]);
                    }
                    $consent = null;
                    $this->write(['form_consent' => null, 'send_state' => 'pending']);
                }
                $menu = $this->current();
            }
            $campaign = null;
            if ($menu->send_state === 'verify_benefits') {
                if (CarbonImmutable::parse($menu->entry_received_at)->addHours(8)->lte(now())) {
                    return $this->finish('expired', 'member_benefits_window_elapsed');
                }
                $campaign = app(EdnaMemberBenefitsButton::class)->verifiedReply($payload);
                if ($campaign === null) {
                    if (app(WebFormContinuation::class)->receive($event, $payload)) {
                        return $this->finish('preserved', 'web_continuity_priority');
                    }
                    $this->write(['send_state' => 'pending']);
                    $menu = $this->current();
                }
            }
            if ($consent === null && $menu->send_state === 'pending'
                && app(WebChatContinuity::class)->blocksOutbound($event, $menu->proof ? json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR) : null)) {
                return $this->finish('preserved', 'web_continuity_priority', ['transfer_state' => 'preserved']);
            }
            // Pending work captured before the paid/organic split can change route
            // only while no greeting has been attempted. Accepted or uncertain
            // sends keep their original receipt and are never followed by a replay.
            if ($menu->send_state === 'pending' && ! $menu->choice_event_id
                && ($paid = app(EdnaPaidEntry::class)->classify($event, $payload))) {
                return DB::transaction(function () use ($event, $payload, $paid): array {
                    $sendId = (new EdnaFlowRouter)->startPaidEntry($event, $payload, $paid);

                    return $this->finish('preserved', $sendId ? 'paid_entry_routed_direct_v3' : 'paid_existing_flow_preserved',
                        $sendId ? ['flow_send_id' => $sendId, 'transfer_state' => 'preserved'] : ['transfer_state' => 'preserved']);
                });
            }
            $proof = $consent['native_proof'] ?? ($menu->proof ? json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR) : null);
            if (! $proof) {
                $this->assertBudget(35);
                $proof = $this->entryProof($menu, $event, $payload);
                if (! $proof) {
                    return $this->wait('native_message_pending');
                }
            }
            if (! $this->validProof($proof, $event)) {
                return $this->finish('review', 'native_proof_mismatch');
            }
            if (! $this->lockChat((string) $proof['chat_id'])) {
                return $this->wait('chat_routing_in_progress');
            }
            if (isset($consent['action']) && ! isset($consent['native_proof'])) {
                $consent['native_proof'] = $proof;
                $this->write(['form_consent' => json_encode($consent, JSON_THROW_ON_ERROR)]);
            }
            if ($campaign !== null || in_array($consent['action'] ?? '', ['benefits', 'unsubscribe'], true)) {
                $benefits = app(EdnaBenefitsRouting::class);
                $decision = $campaign === null ? $benefits->reserveCampaign($event, $proof, $consent)
                    : $benefits->reserveMemberButton($event, $proof, $campaign);
                if ($decision['state'] === 'waiting') {
                    return $this->wait($decision['reason']);
                }

                return $this->finish($decision['state'], $decision['reason'], [
                    'send_state' => 'not_needed', 'transfer_state' => 'not_needed',
                ]);
            }
            if ($consent === null && ! $uncertainSend && ! $uncertainTransfer && $this->pendingTemplateReply($menu)) {
                return $this->wait('template_reply_binding_pending');
            }
            $other = DB::table('edna_organic_menus')->where('subject_id', $menu->subject_id)
                ->where('chat_id', $proof['chat_id'])->where('session_id', $proof['session_id'])->where('id', '!=', $menu->id)->first();
            if ($other) {
                if ($consent !== null && ! $uncertainTransfer) {
                    $context = $other->form_consent ?? $other->campaign_prompt;
                    $active = $context ? json_decode($context, true, 32, JSON_THROW_ON_ERROR) : null;
                    if (in_array($consent['action'] ?? '', ['decline', 'defer', 'feedback', 'link'], true)
                        && (($active && $active['reply_out_message_id'] !== $consent['reply_out_message_id'])
                            || (! $active && $other->send_state === 'confirmed')
                            || $other->choice_event_id || $other->transfer_intent || $other->flow_send_id)) {
                        // Record this response without canceling a different request in the same chat.
                        return $this->finish('preserved', 'campaign_'.$consent['action'].'_recorded', ['transfer_state' => 'not_needed']);
                    }
                    return $this->continueConsentOnSession($menu, $other, $consent, $proof);
                }
                return $this->finish('duplicate', 'menu_already_reserved_for_session', [
                    'canonical_menu_id' => $other->canonical_menu_id ?: $other->id,
                ]);
            }
            if (! $menu->chat_id || ! isset($consent['native_proof'])) {
                $this->write(['chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'],
                    'proof' => json_encode($proof, JSON_THROW_ON_ERROR)]);
            }
            $menu = $this->current();
            if ($consent !== null) {
                if ($uncertainTransfer) {
                    return $this->reconcileTransfer($menu, $proof);
                }
                $action = $consent['action'] ?? 'form_consent';
                if (in_array($action, ['decline', 'defer', 'feedback', 'link'], true)) {
                    return $this->finish('preserved', 'campaign_'.$action.'_recorded', ['transfer_state' => 'not_needed']);
                }
                if ($consent['choice'] === 'no') {
                    return $this->finish('preserved', 'form_consent_declined', ['transfer_state' => 'not_needed']);
                }
                if ($action === 'form_consent') {
                    $case = app(EdnaConsentCase::class)->resolve($proof, $payload, $consent['outbound']);
                } else {
                    $resolution = app(EdnaConsentCase::class)->campaign($proof, $payload, $consent);
                    if ($resolution['status'] === 'no_active_case' && in_array($action, ['offer', 'clarify'], true)) {
                        return $this->requestCampaignIntent($menu, $consent);
                    }
                    if ($resolution['status'] === 'closed') {
                        return $this->finish('preserved', $resolution['reason'], ['transfer_state' => 'not_needed']);
                    }
                    if ($resolution['status'] === 'waiting_assignment') {
                        return $this->awaitAssignment($menu, $resolution['reason']);
                    }
                    if ($resolution['status'] !== 'assigned') {
                        return $this->wait($resolution['reason']);
                    }
                    $case = $resolution['case'];
                }
                if (! $case) {
                    return $this->wait('form_consent_case_unverified');
                }
                if ($menu->deal_id && ((string) $menu->deal_id !== $case['ID'] || (string) $menu->seller_id !== $case['ASSIGNED_BY_ID'])) {
                    return $this->finish('preserved', 'form_consent_assignment_changed');
                }
                $this->write(['deal_id' => $case['ID'], 'seller_id' => $case['ASSIGNED_BY_ID']]);

                return $this->transfer($this->current(), $proof, (int) $case['ASSIGNED_BY_ID'], $case);
            }
            if ($menu->send_state === 'pending'
                && app(EdnaPaidFlowGuard::class)->pendingForRecipient($menu->subject_id, $menu->phone_hash)) {
                return $this->wait('paid_intake_binding_pending');
            }
            if ($menu->send_state === 'pending' && app(EdnaPaidFlowGuard::class)->continuesSession($proof, $menu->subject_id)) {
                return $this->finish('preserved', 'paid_intake_session_preserved', ['transfer_state' => 'preserved']);
            }
            if ($uncertainTransfer) {
                return $this->reconcileTransfer($menu, $proof);
            }
            if ($uncertainSend) {
                $this->assertBudget(13);
                $result = $this->transport->reconcile($menu);
                $this->write($result);
                if ($result['send_state'] === 'confirmed') {
                    $menu = $this->current();

                    return $this->finish($menu->choice_event_id ? 'selected' : 'awaiting_choice', 'menu_outgoing_confirmed');
                }
                if ($result['send_state'] === 'rejected') {
                    return $this->finish('review', $result['send_reason'] ?? 'menu_outgoing_rejected');
                }

                return $this->wait('menu_outgoing_unconfirmed', ['send_state' => 'unknown'], true);
            }
            if (CarbonImmutable::parse($menu->expires_at)->isPast()) {
                return $this->finish('expired', 'conversation_window_elapsed');
            }
            if (! $menu->choice_event_id && ($benefits = $this->benefitsDecision($menu, $proof))) {
                return $benefits;
            }
            if ($menu->send_state === 'pending') {
                return $this->send($menu, $proof);
            }
            if ($menu->send_state !== 'confirmed') {
                return $this->finish('review', 'menu_outgoing_not_confirmed');
            }
            if ($menu->state === 'route_pending') {
                if ($benefits = $this->benefitsDecision($menu, $proof)) {
                    return $benefits;
                }

                return $this->transfer($menu, $proof, (int) $menu->seller_id);
            }
            if (! $menu->choice_event_id) {
                return $this->finish('awaiting_choice', 'menu_waiting_for_choice');
            }
            $choiceEvent = DB::table('edna_incoming_events')->find($menu->choice_event_id);
            $choicePayload = $choiceEvent ? $this->authenticatedPayload($choiceEvent) : null;
            if (! $choicePayload || ! $this->matchesChoice($menu, $choiceEvent, $choicePayload, true)) {
                return $this->finish('review', 'choice_context_mismatch');
            }
            $choiceProof = $proof['choice_proof'] ?? null;
            if (! $choiceProof) {
                $this->assertBudget(35);
                $choiceProof = $this->binding->resolveCurrent($choiceEvent, $choicePayload, (int) $proof['chat_id']);
            }
            if (! $choiceProof) {
                return $this->wait('native_choice_pending');
            }
            if (! $this->validProof($choiceProof, $choiceEvent)
                || (string) $choiceProof['chat_id'] !== (string) $proof['chat_id']
                || (string) $choiceProof['session_id'] !== (string) $proof['session_id']) {
                return $this->finish('preserved', 'choice_native_session_changed');
            }
            $proof['choice_proof'] = $choiceProof;
            $this->write(['proof' => json_encode($proof, JSON_THROW_ON_ERROR)]);
            if ($benefits = $this->benefitsDecision($menu, $proof)) {
                return $benefits;
            }
            if ($menu->choice === 'other') {
                return $this->transfer($menu, $proof, (int) config('edna.organic_other_operator_id', 5737));
            }
            if ($menu->choice !== 'loan') {
                return $this->finish('review', 'unsupported_menu_choice');
            }
            if ($menu->campaign_prompt !== null) {
                $receipt = json_decode($menu->campaign_prompt, true, 32, JSON_THROW_ON_ERROR);
                $source = DB::table('edna_incoming_events')->find($receipt['entry_event_id']);
                $original = $source ? $this->authenticatedPayload($source) : null;
                if (! $original) {
                    return $this->finish('review', 'campaign_original_unavailable');
                }
                $order = $this->campaignReplyOrder($receipt);
                if ($order !== null) {
                    return $order === 'waiting' ? $this->wait('campaign_newer_reply_pending')
                        : $this->finish('preserved', 'campaign_newer_reply_declined', ['transfer_state' => 'not_needed']);
                }
                $resolution = app(EdnaConsentCase::class)->campaign($receipt['native_proof'], $original, $receipt);
                if ($resolution['status'] === 'assigned') {
                    $case = $resolution['case'];
                    $this->write(['form_consent' => $menu->campaign_prompt, 'deal_id' => $case['ID'], 'seller_id' => $case['ASSIGNED_BY_ID']]);
                    return $this->transfer($this->current(), $receipt['native_proof'], (int) $case['ASSIGNED_BY_ID'], $case);
                }
                if ($resolution['status'] === 'closed') {
                    return $this->finish('preserved', $resolution['reason']);
                }
                if ($resolution['status'] !== 'no_active_case') {
                    return $resolution['status'] === 'waiting_assignment' ? $this->awaitAssignment($menu, $resolution['reason'])
                        : $this->wait($resolution['reason']);
                }
            }
            $this->assertBudget(35);
            $attention = $this->attention->inspectWelcome($proof);
            if (($attention['status'] ?? '') !== 'ready') {
                return $this->attentionDecision($attention);
            }

            return DB::transaction(function (): array {
                $result = $this->finish('loan_pending', 'loan_profile_pending', ['available_at' => now(), 'enqueued_at' => null]);
                if ($result['state'] === 'loan_pending') {
                    app(EdnaOrganicLoan::class)->enqueue($this->menuId);
                }

                return $result;
            });
        } catch (Throwable) {
            $current = $this->current();
            $transfer = in_array($current?->transfer_state, ['sending', 'unknown'], true);
            $send = in_array($current?->send_state, ['sending', 'accepted', 'unknown'], true);

            return $this->wait($transfer ? 'transfer_result_uncertain' : ($send ? 'menu_result_uncertain' : 'provider_reads_pending'),
                $transfer ? ['transfer_state' => 'unknown'] : ($send ? ['send_state' => 'unknown'] : []), $transfer || $send);
        } finally {
            try {
                $this->chatLock?->release();
            } catch (Throwable) {
                // Expiry releases a lost lock; no failed release can replay an effect.
            }
        }
    }

    /** A callback can arrive after an ordinary greeting in the same session. Keep one writer and its original receipt. */
    private function continueConsentOnSession(object $menu, object $other, array $consent, array $proof): array
    {
        return DB::transaction(function () use ($menu, $other, $consent, $proof): array {
            $canonical = DB::table('edna_organic_menus')->where('id', $other->id)->lockForUpdate()->firstOrFail();
            if ($canonical->lease_until && CarbonImmutable::parse($canonical->lease_until)->isFuture()) {
                return $this->wait('form_consent_session_busy');
            }
            $context = $canonical->form_consent ?? $canonical->campaign_prompt;
            $previous = $context ? json_decode($context, true, 32, JSON_THROW_ON_ERROR) : null;
            if (! $canonical->transfer_intent && in_array($canonical->send_state, ['sending', 'accepted', 'unknown'], true)
                && in_array($canonical->state, ['waiting', 'pending', 'unknown'], true)) {
                return $this->wait('form_consent_prior_send_pending');
            }
            $canContinue = in_array($canonical->state, ['pending', 'consent_pending', 'waiting', 'awaiting_choice'], true)
                || in_array($canonical->reason, ['form_consent_declined', 'campaign_decline_recorded', 'campaign_defer_recorded',
                    'campaign_feedback_recorded', 'campaign_link_recorded'], true);
            $at = CarbonImmutable::parse($consent['received_at']);
            $previousAt = isset($previous['received_at']) ? CarbonImmutable::parse($previous['received_at']) : null;
            $newer = ! $previous || ($previousAt && ($at->gt($previousAt)
                || ($at->equalTo($previousAt) && $consent['choice'] === 'no' && ($previous['choice'] ?? '') !== 'no')));
            if ($canContinue && ! $canonical->transfer_intent && ! $canonical->flow_send_id && ! $canonical->choice_event_id
                && ! in_array($canonical->send_state, ['sending', 'accepted', 'unknown'], true)
                && $newer) {
                $consent['native_proof'] = $proof;
                DB::table('edna_organic_menus')->where('id', $canonical->id)->update([
                    'form_consent' => json_encode($consent, JSON_THROW_ON_ERROR),
                    'state' => 'consent_pending', 'reason' => 'form_consent_received', 'expires_at' => $menu->expires_at,
                    'send_state' => $canonical->send_state === 'pending' ? 'not_needed' : $canonical->send_state,
                    'attempts' => 0, 'available_at' => now(), 'enqueued_at' => null, 'updated_at' => now(),
                ]);
            }

            return $this->finish('duplicate', 'form_consent_existing_session', ['canonical_menu_id' => $canonical->id]);
        });
    }

    private function pendingTemplateReply(object $menu): bool
    {
        // Another worker may bind this button after our native read. Recipient alone can defer an
        // effect, never authorize one. The session lease serializes the two writers after binding.
        return DB::table('edna_organic_menus')->where('subject_id', $menu->subject_id)->where('phone_hash', $menu->phone_hash)
            ->where('id', '!=', $menu->id)->whereNull('session_id')->whereNull('canonical_menu_id')->where('expires_at', '>', now())
            ->where(fn ($q) => $q->whereIn('send_state', ['verify_campaign', 'verify_benefits'])
                ->orWhereNotNull('form_consent->action')->orWhere(fn ($c) => $c
                ->whereNotNull('form_consent')->where('entry_received_at', '<=', $menu->entry_received_at)))
            ->whereIn('state', ['consent_pending', 'waiting', 'pending'])->exists();
    }

    private function send(object $menu, array $proof): array
    {
        if (CarbonImmutable::parse($menu->entry_received_at)->lt(now()->subHours(23))) {
            return $this->finish('expired', 'menu_send_window_elapsed');
        }
        $this->assertBudget(35);
        $attention = $this->attention->inspectWelcome($proof);
        if (($attention['status'] ?? '') !== 'ready') {
            return $this->attentionDecision($attention);
        }
        $this->assertBudget(13);
        $this->transport->assertChannel($menu);
        if ($benefits = $this->benefitsDecision($menu, $proof)) {
            return $benefits;
        }
        $this->assertBudget(35);
        $fresh = $this->attention->inspectWelcome($proof);
        if (($fresh['status'] ?? '') !== 'ready'
            || (string) ($fresh['owner_id'] ?? '') !== (string) ($attention['owner_id'] ?? '')
            || (string) ($fresh['session_id'] ?? '') !== (string) ($attention['session_id'] ?? '')) {
            return ($fresh['status'] ?? '') !== 'ready' ? $this->attentionDecision($fresh)
                : $this->finish('preserved', 'attention_changed_before_menu');
        }
        $current = $this->current();
        if ($current->send_state !== 'pending' || ! $this->enabled()) {
            return $this->wait('menu_send_gate_changed');
        }
        $this->assertBudget(13);
        $replyPending = false;
        $claim = function () use ($menu, $proof, &$replyPending): bool {
            if ($replyPending = $this->pendingTemplateReply($menu)) {
                return false;
            }
            $event = DB::table('edna_incoming_events')->find($menu->entry_event_id);
            if ($event && app(WebChatContinuity::class)->blocksOutbound($event, $proof)) {
                return false;
            }
            if ($menu->campaign_prompt !== null) {
                $receipt = json_decode($menu->campaign_prompt, true, 32, JSON_THROW_ON_ERROR);
                $order = $this->campaignReplyOrder($receipt);
                if ($order !== null) {
                    $replyPending = $order === 'waiting';
                    return false;
                }
            }
            $this->write(['send_state' => 'sending', 'send_started_at' => now()]);

            return true;
        };
        $entry = DB::table('edna_incoming_events')->find($menu->entry_event_id);
        $claimed = $entry && app(WebChatContinuity::class)->eligibleEntry($entry)
            ? app(WebFormReceipt::class)->serialized($menu->phone_hash, $claim) : $claim();
        if (! $claimed) {
            if ($replyPending) {
                return $this->wait('template_reply_binding_pending');
            }
            return $this->finish('preserved', $menu->campaign_prompt !== null ? 'campaign_or_web_context_changed' : 'web_continuity_priority',
                ['transfer_state' => 'preserved']);
        }
        $this->assertLease();
        $result = $this->transport->schedule($this->current());
        $this->write($result);
        if ($result['send_state'] === 'rejected') {
            return $this->finish('review', $result['send_reason'] ?? 'menu_schedule_rejected');
        }

        return $this->finish($result['send_state'] === 'unknown' ? 'unknown' : 'waiting', 'menu_history_pending');
    }

    private function requestCampaignIntent(object $menu, array $receipt): array
    {
        // A request for information is not an application. Reuse the normal signed choice,
        // human-attention gates and delivery reconciliation before the profile or v3 path.
        $fields = ['form_consent' => null, 'campaign_prompt' => json_encode($receipt, JSON_THROW_ON_ERROR)];
        if ($menu->send_state === 'confirmed') {
            // The session already has a delivered prompt with live buttons.
            return $this->finish('awaiting_choice', 'campaign_waiting_for_intent', $fields);
        }
        $this->write($fields + ['send_state' => 'pending']);

        // send() checks the canonical entry with its own native proof. The campaign
        // click can be a later message in that same session.
        return $this->send($this->current(), json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR));
    }

    private function awaitAssignment(object $menu, string $reason): array
    {
        $delay = app(WebFormChatRetryPolicy::class)->delaySeconds((int) $menu->attempts);

        return $this->finish('waiting', $reason, [
            'available_at' => CarbonImmutable::parse($menu->expires_at)->min(now()->addSeconds($delay)),
        ]);
    }

    private function campaignReplyOrder(array $receipt): ?string
    {
        $event = DB::table('edna_incoming_events')->find($receipt['entry_event_id']);
        $payload = $event ? $this->authenticatedPayload($event) : null;
        if (! $payload || ! isset($receipt['native_proof'])) {
            return 'waiting';
        }

        return app(EdnaCampaignReplyOrder::class)->decision($receipt['outbound'], $payload, $receipt['native_proof']);
    }

    private function benefitsDecision(object $menu, array $proof): ?array
    {
        // A new choice can continue an old conversation without replaying its
        // original entry. Each action is proved by its own native message.
        $entryId = $menu->entry_event_id;
        if ($menu->choice_event_id && is_array($proof['choice_proof'] ?? null)) {
            $entryId = $menu->choice_event_id;
            $proof = $proof['choice_proof'];
        }
        $event = DB::table('edna_incoming_events')->find($entryId);
        if (! $event || ! ($decision = app(EdnaBenefitsRouting::class)->check($event, $proof))) {
            return null;
        }
        $reason = $decision['reason'] ?? 'benefits_routing';
        if (($decision['state'] ?? '') === 'waiting') {
            return $this->wait($reason);
        }

        return $this->finish(($decision['state'] ?? '') === 'review' ? 'review' : 'preserved', $reason,
            ['transfer_state' => 'preserved']);
    }

    private function transfer(object $menu, array $proof, int $target, ?array $consentCase = null): array
    {
        $this->assertBudget(6);
        if ($target < 1 || ! $this->attention->targetActive($target)) {
            return $consentCase !== null ? $this->wait('form_consent_seller_unavailable') : $this->finish('review', 'routing_target_unavailable');
        }
        $case = $consentCase ?? $this->commercialCase($menu, $target);
        if ($menu->state === 'route_pending' && $case === null) {
            return $this->finish('preserved', 'commercial_assignment_changed');
        }
        $this->assertBudget(65);
        $attention = $this->attention->inspect($proof, $target);
        if (($attention['status'] ?? '') === 'already_assigned') {
            return $this->finish('routed', 'already_with_target', ['transfer_state' => 'not_needed', 'seller_id' => (string) $target]);
        }
        if (($attention['status'] ?? '') !== 'ready') {
            return $this->attentionDecision($attention);
        }
        $before = $attention['native_snapshot'] ?? null;
        $otherInquiry = $menu->choice === 'other' && $case === null
            && $target === (int) config('edna.organic_other_operator_id', 5737);
        $verifiedContact = isset($case['contact_deal_stage']) || $consentCase !== null ? $case['CONTACT_ID'] : null;
        if (! is_array($before) || ! $this->attention->canTransfer($before, $target, $otherInquiry, $verifiedContact)) {
            return $this->finish('preserved', 'native_crm_assignment_preserved');
        }
        $this->assertBudget(65);
        $fresh = $this->attention->inspect($proof, $target);
        if (($fresh['status'] ?? '') !== 'ready') {
            return $this->attentionDecision($fresh);
        }
        $this->assertBudget(12);
        if (! is_array($fresh['native_snapshot'] ?? null)
            || ! $this->attention->compatible($before, $fresh['native_snapshot'], $target, false, $otherInquiry, $verifiedContact)
            || ! $this->attention->targetActive($target)
            || ($case !== null && $this->commercialCase($menu, $target, true) !== $case)) {
            return $this->finish('preserved', 'routing_context_changed');
        }
        if (isset($case['contact_deal_stage']) && ! $this->attention->confirmContactDeal($proof, $fresh['native_snapshot'],
            $verifiedContact, $case['ID'], $target, $case['contact_deal_stage'])) {
            return $this->finish('preserved', 'contact_deal_or_attention_changed');
        }
        if ($consentCase !== null) {
            $last = $this->attention->inspect($proof, $target);
            if (($last['status'] ?? '') !== 'ready') {
                return $this->attentionDecision($last);
            }
            if (! is_array($last['native_snapshot'] ?? null)
                || ! $this->attention->compatible($fresh['native_snapshot'], $last['native_snapshot'], $target, false, false, $verifiedContact)
                || (string) $last['owner_id'] !== (string) $fresh['owner_id']) {
                return $this->finish('preserved', 'form_consent_attention_changed');
            }
            if (CarbonImmutable::parse($menu->expires_at)->lte(now())) {
                return $this->finish('expired', 'form_consent_window_elapsed');
            }
            $consent = json_decode($menu->form_consent, true, 32, JSON_THROW_ON_ERROR);
            if (isset($consent['action'])) {
                $benefits = DB::table('edna_benefit_chat_routes')->where('chat_id', $proof['chat_id'])
                    ->where('session_id', $proof['session_id'])->whereNotIn('state', ['not_applicable', 'expired'])
                    ->where(fn ($q) => $q->whereNull('reason')->orWhere('reason', '!=', 'benefits_campaign_declined')
                        ->orWhereNotNull('transfer_intent')->orWhereNotNull('case_snapshot'))
                    ->where(fn ($q) => $q->whereNotNull('campaign_reply')->orWhereNotNull('case_snapshot'))->exists();
                if ($benefits) {
                    return $this->finish('preserved', 'campaign_benefits_session_preserved', ['transfer_state' => 'preserved']);
                }
                if ($this->pendingTemplateReply($menu)) {
                    return $this->wait('template_reply_binding_pending');
                }
                $order = $this->campaignReplyOrder($consent);
                if ($order !== null) {
                    return $order === 'waiting' ? $this->wait('campaign_newer_reply_pending')
                        : $this->finish('preserved', 'campaign_newer_reply_declined', ['transfer_state' => 'not_needed']);
                }
            }
            // A newer click for the same original send may be awaiting its own worker, including an opt-out.
            $siblings = DB::table('edna_organic_menus')->where('subject_id', $menu->subject_id)->where('phone_hash', $menu->phone_hash)
                ->where('form_consent->reply_out_message_id', $consent['reply_out_message_id'])->where('id', '!=', $menu->id)
                ->whereNull('canonical_menu_id')->pluck('form_consent');
            foreach ($siblings as $sibling) {
                $other = json_decode($sibling, true, 32, JSON_THROW_ON_ERROR);
                $otherAt = CarbonImmutable::parse($other['received_at']);
                $received = CarbonImmutable::parse($consent['received_at']);
                if ($other['entry_event_id'] !== $consent['entry_event_id']
                    && (! isset($other['native_proof']) || ($other['native_proof']['chat_id'] === $proof['chat_id']
                        && $other['native_proof']['session_id'] === $proof['session_id']))
                    && ($otherAt->gt($received) || ($otherAt->eq($received)
                        && (($other['choice'] ?? null) === 'no' || $other['entry_event_id'] > $consent['entry_event_id'])))) {
                    return $this->wait('form_consent_newer_reply_pending');
                }
            }
        }
        $intent = ['target_id' => (string) $target, 'session_id' => (string) $proof['session_id'],
            'owner_before' => (string) $fresh['owner_id'], 'snapshot' => $fresh['native_snapshot'],
            'commercial_case' => $case, 'routing_policy' => $otherInquiry ? 'other_inquiry' : 'commercial',
            'created_at' => now()->toIso8601String()];
        $this->assertBudget(6);
        $this->write(['transfer_state' => 'sending', 'transfer_intent' => json_encode($intent, JSON_THROW_ON_ERROR),
            'seller_id' => (string) $target, 'transfer_acknowledged' => false]);
        $this->assertLease();
        try {
            $ack = $this->crm->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $proof['chat_id'], 'USER_ID' => $target]);
            $this->write(['transfer_acknowledged' => $ack === true, 'transfer_state' => 'unknown']);
        } catch (Throwable) {
            $this->write(['transfer_state' => 'unknown']);
        }

        return $this->finish('unknown', 'transfer_confirmation_pending');
    }

    private function reconcileTransfer(object $menu, array $proof): array
    {
        $intent = $menu->transfer_intent ? json_decode($menu->transfer_intent, true, 32, JSON_THROW_ON_ERROR) : null;
        if (! is_array($intent) || ! $this->positiveId($intent['target_id'] ?? null)
            || ! is_array($intent['snapshot'] ?? null)
            || ! array_key_exists('commercial_case', $intent)
            || (string) ($intent['session_id'] ?? '') !== (string) $proof['session_id']) {
            return $this->finish('review', 'transfer_intent_unavailable', ['transfer_state' => 'unknown']);
        }
        $this->assertBudget(6);
        $dialog = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $proof['chat_id']]);
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        if (! is_array($dialog) || (string) ($dialog['id'] ?? '') !== (string) $proof['chat_id']
            || (string) ($parts[5] ?? '') !== (string) $proof['session_id']
            || ! in_array($dialog['text_field_enabled'] ?? null, [true, 'Y', 1, '1'], true)) {
            return $this->finish('preserved', 'session_changed_after_transfer', ['transfer_state' => 'unknown']);
        }
        $owner = (string) ($dialog['owner'] ?? 0);
        $target = (int) $intent['target_id'];
        if ($owner === (string) $target) {
            $this->assertBudget(30);
            $after = $this->attention->snapshot($proof);
            $otherInquiry = ($intent['routing_policy'] ?? '') === 'other_inquiry' && $menu->choice === 'other'
                && $intent['commercial_case'] === null && $target === (int) config('edna.organic_other_operator_id', 5737);
            $verifiedContact = isset($intent['commercial_case']['contact_deal_stage']) || isset($intent['commercial_case']['consent_activity_id'])
                ? $intent['commercial_case']['CONTACT_ID'] : null;
            if (! $this->attention->compatible($intent['snapshot'], $after, $target, true, $otherInquiry, $verifiedContact)
                || ($intent['commercial_case'] !== null && $this->commercialCase($menu, $target, true) !== $intent['commercial_case'])) {
                return $this->finish('review', 'crm_changed_after_transfer', ['transfer_state' => 'observed']);
            }

            return $this->finish('routed', $menu->transfer_acknowledged ? 'target_confirmed' : 'target_observed_after_uncertain_post',
                ['transfer_state' => $menu->transfer_acknowledged ? 'confirmed' : 'observed']);
        }
        if (! in_array($owner, ['0', '', (string) $intent['owner_before']], true)) {
            return $this->finish('preserved', 'human_assignment_after_transfer', ['transfer_state' => 'unknown']);
        }

        return $this->wait('transfer_result_uncertain', ['transfer_state' => 'unknown'], true);
    }

    private function commercialCase(object $menu, int $target, bool $required = false): ?array
    {
        if ($menu->form_consent !== null) {
            $consent = json_decode($menu->form_consent, true, 32, JSON_THROW_ON_ERROR);
            $entry = DB::table('edna_incoming_events')->find($consent['entry_event_id']);
            $payload = $entry ? $this->authenticatedPayload($entry) : null;
            $proof = $consent['native_proof'] ?? json_decode($menu->proof, true, 32, JSON_THROW_ON_ERROR);
            $case = null;
            if ($payload && in_array($consent['action'] ?? '', ['continue', 'offer', 'clarify'], true)) {
                $decision = app(EdnaConsentCase::class)->campaign($proof, $payload, $consent);
                $case = $decision['status'] === 'assigned' ? $decision['case'] : null;
            } elseif ($payload && ($consent['choice'] ?? '') === 'yes') {
                $case = app(EdnaConsentCase::class)->resolve($proof, $payload, $consent['outbound']);
            }

            return $case && (string) $case['ASSIGNED_BY_ID'] === (string) $target && (string) $case['ID'] === (string) $menu->deal_id ? $case : null;
        }
        if ($menu->state !== 'route_pending' && ! $required) {
            return null;
        }
        try {
            $evidence = json_decode($menu->profile_evidence ?? '', true, 32, JSON_THROW_ON_ERROR);
            $assigned = $evidence['assigned_case'] ?? null;
            $profile = json_decode(Crypt::decryptString($menu->profile_snapshot ?? ''), true, 32, JSON_THROW_ON_ERROR);
            $identity = is_array($profile) && is_string($profile['cuil'] ?? null)
                ? (new WebFormReceipt)->identityHash($profile['cuil']) : null;
        } catch (Throwable) {
            return null;
        }
        if (! is_array($assigned) || ! $this->positiveId($menu->deal_id)
            || ! $this->positiveId($assigned['deal_id'] ?? null) || ! $this->positiveId($assigned['seller_id'] ?? null)
            || (string) ($assigned['deal_id'] ?? '') !== (string) $menu->deal_id
            || (string) ($assigned['seller_id'] ?? '') !== (string) $target
            || ! $this->positiveId($assigned['contact_id'] ?? null)
            || ! array_key_exists('lead_id', $assigned)
            || ! is_string($assigned['profile_identity_hash'] ?? null) || ! $identity
            || ! hash_equals($identity, $assigned['profile_identity_hash'])) {
            return null;
        }
        $contactId = (string) $assigned['contact_id'];
        $emptyLead = in_array($assigned['lead_id'], ['', '0', 0, null], true);
        if (! $emptyLead && ! $this->positiveId($assigned['lead_id'])) {
            return null;
        }
        $leadId = $emptyLead ? '' : (string) $assigned['lead_id'];
        $this->assertBudget(6);
        $deal = $this->crm->call('crm.deal.get', ['id' => $menu->deal_id]);
        if (! is_array($deal)) {
            return null;
        }
        $currentLead = in_array($deal['LEAD_ID'] ?? null, ['', '0', 0, null], true) ? '' : (string) $deal['LEAD_ID'];
        if ((string) ($deal['ID'] ?? '') !== (string) $menu->deal_id
            || (string) ($deal['ASSIGNED_BY_ID'] ?? '') !== (string) $target
            || (string) ($deal['CONTACT_ID'] ?? '') !== $contactId || $currentLead !== $leadId
            || (int) ($deal['CATEGORY_ID'] ?? -1) !== 1 || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P') {
            return null;
        }
        foreach (['contact' => [$contactId, 'UF_CRM_65B7E48033FCD'], 'lead' => [$leadId, 'UF_CRM_1693840106704']] as $entity => [$id, $field]) {
            if ($id === '') {
                continue;
            }
            $this->assertBudget(6);
            $record = $this->crm->call('crm.'.$entity.'.get', ['id' => $id]);
            if (! is_array($record) || (string) ($record['ID'] ?? '') !== $id
                || ! is_string($record[$field] ?? null)
                || ! hash_equals($identity, (new WebFormReceipt)->identityHash($record[$field]) ?? '')
                || ($entity === 'lead' && ! in_array($record['CONTACT_ID'] ?? null, ['', '0', 0, null], true)
                    && (string) $record['CONTACT_ID'] !== $contactId)) {
                return null;
            }
        }

        $snapshot = [];
        foreach (['ID', 'ASSIGNED_BY_ID', 'LEAD_ID', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID'] as $field) {
            $snapshot[$field] = (string) ($deal[$field] ?? '');
        }
        $snapshot['LEAD_ID'] = $leadId;
        $snapshot['profile_identity_hash'] = $identity;
        if (isset($assigned['contact_deal_stage'])) {
            $snapshot['contact_deal_stage'] = $assigned['contact_deal_stage'];
        }

        return $snapshot;
    }

    private function matchesChoice(object $menu, object $event, array $payload, bool $confirmed): bool
    {
        try {
            $choice = EdnaOrganicTransport::parseChoice($payload['messageContent']['payload'] ?? null);
            $received = CarbonImmutable::parse($payload['receivedAt']);

            return $choice !== null && $choice['request_id'] === $menu->request_id
                && (! $menu->choice || $choice['choice'] === $menu->choice)
                && $this->matchesMenu($menu, $event, $payload)
                && $menu->send_started_at && in_array($menu->send_state, ['sending', 'accepted', 'unknown', 'confirmed'], true)
                && (! $confirmed || $menu->send_state === 'confirmed')
                && $received->gte(CarbonImmutable::parse($menu->send_started_at)->subMinute())
                && $received->lte(CarbonImmutable::parse($menu->expires_at))
                && $received->lte(now()->addMinutes(5))
                && (! isset($payload['replyOutMessageExternalRequestId']) || $payload['replyOutMessageExternalRequestId'] === $menu->request_id)
                && (! isset($payload['replyOutMessageId']) || ! $menu->outgoing_message_id
                    || $payload['replyOutMessageId'] === $menu->outgoing_message_id)
                && (! $confirmed || ! isset($payload['replyOutMessageId']) || $payload['replyOutMessageId'] === $menu->outgoing_message_id);
        } catch (Throwable) {
            return false;
        }
    }

    private function matchesMenu(object $menu, object $event, array $payload): bool
    {
        try {
            $phone = $payload['subscriber']['identifier'];

            return $menu->subject_id === $event->subject_id && $menu->subject_id === (string) config('edna.subject_id')
                && $menu->cascade_id === (string) config('edna.cascade_id')
                && Str::isUuid($menu->request_id) && hash_equals(Crypt::decryptString($menu->recipient), $phone)
                && hash_equals($menu->phone_hash, (new AttributionJourney)->phoneHash($phone) ?? '');
        } catch (Throwable) {
            return false;
        }
    }

    private function authenticatedPayload(object $event, ?array $provided = null): ?array
    {
        try {
            $stored = json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
            $phone = $stored['subscriber']['identifier'] ?? null;
            if (! is_array($stored) || ! is_string($phone) || ! preg_match('/^[0-9]{10,15}$/D', $phone)
                || $event->subject_id !== (string) config('edna.subject_id')
                || ($stored['subjectId'] ?? null) !== $event->subject_id || ($stored['id'] ?? null) !== $event->message_id
                || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', (string) ($stored['receivedAt'] ?? ''))
                || ($provided !== null && (($provided['id'] ?? null) !== $stored['id']
                    || ($provided['subjectId'] ?? null) !== $stored['subjectId']
                    || ($provided['subscriber']['identifier'] ?? null) !== $phone))) {
                return null;
            }
            CarbonImmutable::parse($stored['receivedAt']);

            return $stored;
        } catch (Throwable) {
            return null;
        }
    }

    private function enabled(): bool
    {
        return config('edna.enabled') && config('edna.router_enabled') && config('edna.intake_enabled') && config('edna.organic_menu_enabled');
    }

    private function eligible(object $event, array $payload, bool $entryWindow = true): bool
    {
        if (! $this->enabled() || ! (new EdnaIntake)->salesChannelEntry($event, $payload)
            || ! preg_match('/^[1-9][0-9]{0,63}$/D', (string) config('edna.cascade_id'))) {
            return false;
        }
        $start = config('edna.organic_menu_start_at');
        if (! is_string($start) || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $start)) {
            return false;
        }
        try {
            $received = CarbonImmutable::parse($payload['receivedAt']);
            if ($received->lt(CarbonImmutable::parse($start)) || $received->gt(now()->addMinutes(5))
                || ($entryWindow && $received->lt(now()->subHours(23)))) {
                return false;
            }
        } catch (Throwable) {
            return false;
        }
        foreach (['router_recipients', 'intake_recipients', 'organic_menu_recipients'] as $name) {
            $allowed = config('edna.'.$name, []);
            if (! is_array($allowed) || ($allowed && ! in_array($payload['subscriber']['identifier'], $allowed, true))) {
                return false;
            }
        }

        return true;
    }

    private function entryProof(object $menu, object $event, array $payload): ?array
    {
        $chats = DB::table('edna_organic_menus')->where('subject_id', $menu->subject_id)
            ->where('phone_hash', $menu->phone_hash)->whereNotNull('chat_id')->whereNotNull('session_id')
            ->where('proof->verified', true)->where('proof->source', 'bitrix_openline_session')
            ->where('proof->evidence', 'external_message_id')
            ->where('id', '!=', $menu->id)->distinct()->limit(2)->pluck('chat_id');
        if ($chats->count() === 1) {
            $proof = $this->binding->resolveMenuHint($event, $payload, (int) $chats->first());
            if ($proof !== null) {
                return $proof;
            }
            $this->assertBudget(35);
        }

        return $this->binding->resolveCurrent($event, $payload);
    }

    private function validProof(array $proof, object $event): bool
    {
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id'
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $event->id
            || (string) ($proof['entry_message_id'] ?? '') !== (string) $event->message_id) {
            return false;
        }
        foreach (['chat_id', 'session_id', 'activity_id', 'message_id'] as $field) {
            if (! $this->positiveId($proof[$field] ?? null)) {
                return false;
            }
        }

        return true;
    }

    private function lockChat(string $chat): bool
    {
        $store = Cache::getStore();
        if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
            return false;
        }
        $lock = Cache::lock('web-form-chat:'.$chat, 120, $this->token);
        if (! $lock->get()) {
            return false;
        }
        $this->chatLock = $lock;

        return true;
    }

    private function claim(): ?object
    {
        return DB::transaction(function (): ?object {
            $row = $this->current(true);
            if (! $row || ! in_array($row->state, ['pending', 'consent_pending', 'waiting', 'selected', 'unknown', 'route_pending', 'awaiting_choice'], true)
                || ($row->lease_until && CarbonImmutable::parse($row->lease_until)->isFuture())
                || ($row->available_at && CarbonImmutable::parse($row->available_at)->isFuture())
                || ($row->state === 'awaiting_choice' && ! $row->choice_event_id && CarbonImmutable::parse($row->expires_at)->isFuture())) {
                return null;
            }
            DB::table('edna_organic_menus')->where('id', $this->menuId)->update([
                'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addSeconds(120),
                'attempts' => $row->attempts + 1, 'enqueued_at' => null, 'updated_at' => now(),
            ]);

            return $this->current();
        });
    }

    private function current(bool $lock = false): ?object
    {
        return DB::table('edna_organic_menus')->where('id', $this->menuId)->when($lock, fn ($q) => $q->lockForUpdate())->first();
    }

    private function assertLease(): void
    {
        if (microtime(true) >= $this->deadline || ! DB::table('edna_organic_menus')->where('id', $this->menuId)
            ->where('lease_token', $this->token)->where('lease_until', '>', now())->exists()) {
            throw new RuntimeException('Organic menu lease expired.');
        }
    }

    private function assertBudget(int $seconds): void
    {
        $this->assertLease();
        if (microtime(true) + $seconds >= $this->deadline) {
            throw new RuntimeException('Organic menu read phase deferred.');
        }
    }

    private function write(array $fields): void
    {
        $this->assertLease();
        if (DB::table('edna_organic_menus')->where('id', $this->menuId)->where('lease_token', $this->token)
            ->update($fields + ['updated_at' => now()]) !== 1) {
            throw new RuntimeException('Organic menu lease superseded.');
        }
    }

    private function wait(string $reason, array $fields = [], bool $unknown = false): array
    {
        return $this->finish(($this->current()?->attempts ?? 12) >= 12 ? 'review' : ($unknown ? 'unknown' : 'waiting'), $reason, $fields);
    }

    private function attentionDecision(array $attention): array
    {
        if (($attention['status'] ?? '') === 'waiting') {
            return $this->wait($attention['reason'] ?? 'attention_unavailable');
        }

        return $this->finish('preserved', $attention['reason'] ?? 'human_attention_preserved', ['transfer_state' => 'preserved']);
    }

    private function finish(string $state, string $reason, array $fields = []): array
    {
        $updated = DB::table('edna_organic_menus')->where('id', $this->menuId)->where('lease_token', $this->token)->update($fields + [
            'state' => $state, 'reason' => $reason, 'lease_token' => null, 'lease_until' => null,
            'available_at' => now()->addSeconds($state === 'unknown' ? 120 : 60), 'updated_at' => now(),
        ]);
        if ($updated !== 1) {
            return ['state' => 'superseded', 'reason' => 'menu_lease_superseded'];
        }
        try {
            $row = $this->current();
            $context = $row->form_consent ?? $row->campaign_prompt;
            $consent = $context ? json_decode($context, true, 32, JSON_THROW_ON_ERROR) : null;
            app(JourneyLedger::class)->record('whatsapp.organic_menu', [
                'menu_id' => $row->id, 'request_id' => $row->request_id, 'entry_event_id' => $row->entry_event_id,
                'choice_event_id' => $row->choice_event_id, 'chat_id' => $row->chat_id, 'native_session_id' => $row->session_id,
                'state' => $state, 'reason' => $reason, 'choice' => $row->choice, 'send_state' => $row->send_state,
                'outgoing_message_id' => $row->outgoing_message_id, 'flow_send_id' => $row->flow_send_id,
                'seller_id' => $row->seller_id, 'transfer_state' => $row->transfer_state,
                'transfer_acknowledged' => (bool) $row->transfer_acknowledged,
                'consent_entry_event_id' => $consent['entry_event_id'] ?? null,
                'consent_choice' => $consent['choice'] ?? null,
                'campaign_action' => $consent['action'] ?? null,
                'campaign_matcher_id' => $consent['outbound']['matcherId'] ?? null,
                'consent_out_message_id' => $consent['outbound']['messageId'] ?? null,
            ], array_filter(['deal_id' => $row->deal_id, 'case_id' => $row->case_id]), 'whatsapp.organic');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) {
            // Tracking cannot reset a durable or uncertain provider operation.
        }

        return ['state' => $state, 'reason' => $reason];
    }

    private function record(int $eventId, string $action): void
    {
        DB::table('edna_incoming_events')->where('id', $eventId)->update(['router_action' => $action]);
    }

    private function positiveId(mixed $value): bool
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value) === 1;
    }
}
