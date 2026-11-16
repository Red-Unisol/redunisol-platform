<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/** Associates a proven native conversation with its existing web case; never creates CRM records. */
class WebFormChatLinker
{
    private EdnaBitrix $crm;

    private EdnaMessageBinding $binding;

    private WebFormChatGuard $guard;

    private int $entryId;

    private string $token;

    private float $deadline;

    private array $proof = [];

    private string $phoneHash;

    private ?Lock $chatLock = null;

    public function __construct(?EdnaBitrix $crm = null, ?EdnaMessageBinding $binding = null, ?WebFormChatGuard $guard = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
        $this->binding = $binding ?? new EdnaMessageBinding($this->crm);
        $this->guard = $guard ?? new WebFormChatGuard($this->crm);
    }

    public function process(int $entryEventId): array
    {
        $this->entryId = $entryEventId;
        $this->deadline = microtime(true) + 90;
        $this->proof = [];
        $this->chatLock = null;
        $route = $this->claim();
        if (! $route) {
            return ['state' => 'not_claimed'];
        }
        $this->token = $route->lease_token;
        try {
            if (! config('edna.enabled') || ! config('edna.intake_crm_enabled')) {
                $this->decide('waiting', 'crm_routing_disabled');
            }
            $entry = DB::table('edna_incoming_events')->find($entryEventId);
            if (! $entry || ! $entry->payload || (string) $entry->subject_id !== (string) config('edna.subject_id')) {
                $this->decide('review', 'authenticated_entry_unavailable');
            }
            $payload = json_decode(Crypt::decryptString($entry->payload), true, 32, JSON_THROW_ON_ERROR);
            $phoneHash = (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
            if (! $phoneHash || (string) ($payload['id'] ?? '') !== (string) $entry->message_id
                || (string) ($payload['subjectId'] ?? '') !== (string) $entry->subject_id) {
                $this->decide('review', 'authenticated_entry_mismatch');
            }
            $this->phoneHash = $phoneHash;
            $this->proof = $route->proof ? json_decode($route->proof, true, 16, JSON_THROW_ON_ERROR) : [];
            if (! $this->proof) {
                $known = [];
                foreach ((new WebFormChatRouting)->history($phoneHash)->select('proof->chat_id as chat_id')->distinct()->limit(2)->get() as $previous) {
                    if ($this->id($previous->chat_id)) {
                        $known[(string) $previous->chat_id] = true;
                    }
                }
                $this->proof = count($known) === 1
                    ? ($this->binding->resolve($entry, $payload, (int) array_key_first($known)) ?? []) : [];
                if (! $this->proof) {
                    $this->proof = $this->binding->resolve($entry, $payload) ?? [];
                }
            }
            if (! $this->proof) {
                $this->decide('waiting', 'native_message_pending');
            }
            $this->validateProof($entry);
            $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR), 'phone_hash' => $phoneHash]);
            $store = Cache::getStore();
            if (! $store instanceof LockProvider || (! app()->runningUnitTests() && ! $store instanceof DatabaseStore && ! $store instanceof RedisStore)) {
                $this->decide('waiting', 'shared_chat_lock_unavailable');
            }
            $lock = Cache::lock('web-form-chat:'.$this->proof['chat_id'], 120, $this->token);
            if (! $lock->get()) {
                $this->decide('waiting', 'chat_routing_in_progress');
            }
            $this->chatLock = $lock;
            if (in_array($route->transfer_state, ['sending', 'unknown'], true)) {
                return $this->reconcileTransfer($route);
            }

            $continuation = DB::table('web_form_continuations')->where('entry_event_id', $entryEventId)->first();
            $submission = $route->submission_id;
            $reentry = ($continuation->proof_source ?? null) === 'reentry';
            $previousProtection = null;
            if ($reentry) {
                $history = (new WebFormChatRouting)->history($phoneHash)->where('entry_event_id', '!=', $entryEventId)
                    ->where('proof->chat_id', (string) $this->proof['chat_id']);
                $ids = (clone $history)->select('submission_id')->distinct()->limit(2)->pluck('submission_id')->all();
                if (count($ids) !== 1) {
                    $this->decide('review', 'reentry_case_not_unique');
                }
                $candidate = (clone $history)->orderByDesc('entry_event_id')->first();
                if (! $candidate || ! (new WebFormChatRouting)->validHistory($candidate)) {
                    $this->decide('review', 'reentry_history_not_verified');
                }
                // A later waiting/closed message without a protection marker must
                // not erase an earlier human assignment for this same case.
                $protection = (clone $history)->where(function ($query): void {
                    $query->where('proof->protected_assignment', true)->orWhere('proof->protection_released', true);
                })->orderByDesc('entry_event_id')->first();
                if ($protection) {
                    if (! (new WebFormChatRouting)->validHistory($protection)) {
                        $this->decide('review', 'reentry_protection_not_verified');
                    }
                    $previousProtection = json_decode($protection->proof, true, 16, JSON_THROW_ON_ERROR);
                }
                $resolvedSubmission = $ids[0];
                if ($submission && $submission !== $resolvedSubmission) {
                    $this->decide('review', 'reentry_case_changed');
                }
                $submission = $resolvedSubmission;
                $this->write(['submission_id' => $submission]);
            } elseif (! $continuation || $continuation->state !== 'ready'
                || ! in_array($continuation->proof_source, ['reference', 'crm_binding'], true)
                || $continuation->submission_id !== $submission) {
                $this->decide('review', 'web_continuation_not_verified');
            }

            $receipt = DB::table('web_form_receipts')->where('id', $submission)->first();
            if (! $receipt || in_array($receipt->state, ['failed', 'uncertain'], true)) {
                $this->decide('review', 'web_persistence_not_confirmed');
            }
            if ($receipt->state !== 'synced') {
                $this->decide('waiting', 'web_persistence_pending');
            }
            if ($receipt->phone_hash !== $phoneHash || ! $receipt->identity_hash || ! $this->id($receipt->lead_id)) {
                $this->decide('review', 'web_identity_mismatch');
            }
            if ($reentry && DB::table('web_form_receipts')->where('phone_hash', $phoneHash)->where('id', '!=', $submission)
                ->where('received_at', '<=', CarbonImmutable::parse($payload['receivedAt'])->addSeconds(5))
                ->where('expires_at', '>=', CarbonImmutable::parse($payload['receivedAt']))->exists()) {
                $this->decide('review', 'reentry_new_request_requires_reference');
            }
            if (! $reentry) {
                $received = CarbonImmutable::parse($payload['receivedAt']);
                if ($received->lt(CarbonImmutable::parse($receipt->received_at)->subSeconds(5))
                    || $received->gt(CarbonImmutable::parse($receipt->expires_at))) {
                    $this->decide('review', 'web_reference_outside_entry_window');
                }
            }

            $target = $this->target($receipt);
            if ($reentry && ! empty($previousProtection['protected_assignment'])) {
                if (! $this->id($previousProtection['protected_owner_id'] ?? null)) {
                    $this->decide('review', 'reentry_protection_not_verified');
                }
                $this->proof['protected_owner_id'] = $previousProtection['protected_owner_id'];
                if ((string) $previousProtection['protected_owner_id'] !== $target['seller_id']) {
                    $this->proof['protected_assignment'] = true;
                    unset($this->proof['protection_released']);
                    $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR),
                        'state' => 'preserved', 'reason' => 'prior_manual_assignment_preserved', 'transfer_state' => 'preserved']);
                    $this->decide('preserved', 'prior_manual_assignment_preserved');
                }
                // Release is explicit only after the current commercial assignment
                // agrees with the protected human destination.
                $this->proof['protected_assignment'] = false;
                $this->proof['protection_released'] = true;
                $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR)]);
            }
            $this->write(['deal_id' => (string) $target['deal']['ID'], 'seller_id' => $target['seller_id']]);
            $activity = $this->call('crm.activity.get', ['id' => (int) $this->proof['activity_id']]);
            if (! is_array($activity) || ($activity['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
                || (string) ($activity['ASSOCIATED_ENTITY_ID'] ?? '') !== (string) $this->proof['session_id']) {
                $this->decide('review', 'native_activity_mismatch');
            }
            if ((int) ($activity['OWNER_TYPE_ID'] ?? 0) === 1 && $this->id($activity['OWNER_ID'] ?? null)) {
                // A later chat tracker can point to the deal while its original
                // session activity still belongs to a manually assigned Guest.
                $currentLead = (string) ($this->proof['native_lead_id'] ?? '');
                if ($this->id($currentLead) && ! in_array($currentLead, [(string) $activity['OWNER_ID'], (string) $target['lead']['ID']], true)) {
                    $this->decide('preserved', 'native_activity_owner_changed');
                }
                $this->proof['native_lead_id'] = (string) $activity['OWNER_ID'];
                $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR)]);
            } elseif ((int) ($activity['OWNER_TYPE_ID'] ?? 0) === 2 && (string) ($activity['OWNER_ID'] ?? '') !== (string) $target['deal']['ID']) {
                $this->decide('preserved', 'native_activity_case_preserved');
            }
            $native = $this->nativeIdentity($receipt, $target);
            $attention = $this->guard->inspect($this->proof, $target['seller_id']);
            $this->validateDialogCase($attention['dialog'] ?? null, $target);
            if (in_array($attention['status'], ['waiting', 'replaced'], true)) {
                $this->decide($attention['status'] === 'waiting' ? 'waiting' : 'preserved', $attention['reason']);
            }
            // Keep the native association. Additional bindings provide CRM timeline visibility.
            // They do not rewrite the chat's native CRM identity or any record's responsible person.
            $this->link((int) $target['deal']['ID'], (int) $target['contact_id']);
            $this->write(['link_state' => 'linked']);
            if ($attention['status'] === 'closed') {
                return $this->finish('linked', 'native_session_closed');
            }
            if ($attention['status'] === 'preserved') {
                return $this->preserveAttention($attention, $target['seller_id']);
            }

            // Binding calls and commercial processing can overlap a human action. Never use
            // the first destination/owner snapshot as permission for the eventual transfer.
            $fresh = $this->target($receipt);
            if ($fresh['seller_id'] !== $target['seller_id'] || (string) $fresh['deal']['ID'] !== (string) $target['deal']['ID']) {
                $this->decide('preserved', 'commercial_assignment_changed');
            }
            $this->nativeIdentity($receipt, $fresh, $native);
            $attention = $this->guard->inspect($this->proof, $fresh['seller_id']);
            $this->validateDialogCase($attention['dialog'] ?? null, $fresh);
            if ($attention['status'] === 'already_assigned') {
                return $this->finish('routed', 'already_with_assigned_seller', ['transfer_state' => 'not_needed']);
            }
            if ($attention['status'] !== 'ready') {
                if ($attention['status'] === 'preserved') {
                    return $this->preserveAttention($attention, $fresh['seller_id']);
                }

                return $this->finish($attention['status'] === 'waiting' ? 'waiting' : 'preserved', $attention['reason'], ['transfer_state' => 'preserved']);
            }
            $this->finalCheck($receipt, $fresh, $attention, $native);
            $this->proof['transfer_intent'] = ['seller_id' => $fresh['seller_id'], 'session_id' => (string) $this->proof['session_id'],
                'owner_before' => (string) $attention['owner_id'], 'web_lead_id' => (string) $fresh['lead']['ID'],
                'contact_id' => $fresh['contact_id'], 'contact_owner_before' => (string) ($fresh['contact']['ASSIGNED_BY_ID'] ?? ''),
                'native_lead_id' => $native['ID'] ?? null, 'native_owner_before' => $native['ASSIGNED_BY_ID'] ?? null,
                'created_at' => now()->toIso8601String()];
            $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR), 'transfer_state' => 'sending']);
            $this->assertLease();
            try {
                $ack = $this->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $this->proof['chat_id'], 'USER_ID' => (int) $fresh['seller_id']]);
                if ($ack !== true) {
                    $this->decide('unknown', 'transfer_acknowledgement_uncertain');
                }
                $this->proof['transfer_acknowledged'] = true;
                $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR)]);
            } catch (Throwable) {
                // The provider may have applied the POST. A later worker may only read,
                // never send the same transfer again over a subsequent human assignment.
                $this->write(['transfer_state' => 'unknown']);
            }

            return $this->reconcileTransfer(DB::table('web_form_chat_routes')->where('entry_event_id', $entryEventId)->first());
        } catch (WebFormChatDecision $decision) {
            return $this->finish($decision->state, $decision->reason);
        } catch (Throwable) {
            $current = DB::table('web_form_chat_routes')->where('entry_event_id', $entryEventId)->first();
            $unknown = in_array($current?->transfer_state, ['sending', 'unknown'], true);

            return $this->finish($unknown ? 'unknown' : 'waiting', $unknown ? 'transfer_result_uncertain' : 'crm_read_or_link_pending',
                $unknown ? ['transfer_state' => 'unknown'] : []);
        } finally {
            try {
                $this->chatLock?->release();
            } catch (Throwable) {
                // Locks expire; a failed release cannot replay external effects.
            }
        }
    }

    private function target(object $receipt): array
    {
        $lead = $this->call('crm.lead.get', ['id' => $receipt->lead_id]);
        $this->validateLead($lead, $receipt);
        $deals = $this->call('crm.deal.list', ['filter' => ['LEAD_ID' => $receipt->lead_id, 'CATEGORY_ID' => 1],
            'select' => ['ID', 'LEAD_ID', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'ASSIGNED_BY_ID'], 'start' => -1]);
        if (! is_array($deals) || ! array_is_list($deals) || count($deals) >= 50) {
            $this->decide('review', 'commercial_case_not_unique');
        }
        foreach ($deals as $case) {
            if (! is_array($case) || (string) ($case['LEAD_ID'] ?? '') !== (string) $receipt->lead_id
                || (int) ($case['CATEGORY_ID'] ?? 0) !== 1
                || ! in_array($case['STAGE_SEMANTIC_ID'] ?? '', ['P', 'S', 'F'], true)) {
                $this->decide('review', 'commercial_case_identity_mismatch');
            }
        }
        $hasClosedCase = collect($deals)->contains(fn ($deal) => is_array($deal)
            && (string) ($deal['LEAD_ID'] ?? '') === (string) $receipt->lead_id
            && (int) ($deal['CATEGORY_ID'] ?? 0) === 1
            && in_array($deal['STAGE_SEMANTIC_ID'] ?? '', ['S', 'F'], true));
        $deals = array_values(array_filter($deals, fn ($deal) => is_array($deal) && ($deal['STAGE_SEMANTIC_ID'] ?? '') === 'P'));
        if (! $deals) {
            $this->decide($hasClosedCase ? 'review' : 'waiting', $hasClosedCase ? 'commercial_case_closed' : 'commercial_case_not_ready');
        }
        if (count($deals) !== 1) {
            $this->decide('review', 'commercial_case_not_unique');
        }
        $deal = $deals[0];
        $contact = (string) ($lead['CONTACT_ID'] ?? '');
        if ((string) ($deal['LEAD_ID'] ?? '') !== (string) $receipt->lead_id || (int) ($deal['CATEGORY_ID'] ?? 0) !== 1
            || ($deal['STAGE_SEMANTIC_ID'] ?? '') !== 'P' || (string) ($deal['CONTACT_ID'] ?? '') !== $contact) {
            $this->decide('review', 'commercial_case_identity_mismatch');
        }
        $seller = (string) ($deal['ASSIGNED_BY_ID'] ?? '');
        if (! $this->id($seller) || in_array($seller, ['57', '71283'], true)
            || in_array($deal['STAGE_ID'] ?? '', ['C1:KESTRA_PENDING', 'C1:KESTRA_QUEUE'], true)) {
            $this->decide('waiting', 'commercial_seller_not_ready');
        }
        if ((string) ($lead['ASSIGNED_BY_ID'] ?? '') !== $seller) {
            $this->decide('preserved', 'crm_responsibles_disagree');
        }
        $contactRecord = $this->call('crm.contact.get', ['id' => $contact]);
        if (! is_array($contactRecord) || (string) ($contactRecord['ID'] ?? '') !== $contact
            || (new WebFormReceipt)->identityHash((string) ($contactRecord['UF_CRM_65B7E48033FCD'] ?? '')) !== $receipt->identity_hash) {
            $this->decide('review', 'contact_identity_changed');
        }
        if (! in_array((string) ($contactRecord['ASSIGNED_BY_ID'] ?? ''), ['0', '71283', $seller], true)) {
            $this->decide('preserved', 'contact_responsible_preserved');
        }
        $users = $this->call('user.get', ['ID' => $seller]);
        $user = is_array($users) && count($users) === 1 ? $users[0] : null;
        if (! $user || (string) ($user['ID'] ?? '') !== $seller || ! in_array($user['ACTIVE'] ?? null, [true, 'Y', 1, '1'], true)
            || empty($user['UF_DEPARTMENT']) || in_array($user['EXTERNAL_AUTH_ID'] ?? '', ['bot', 'imconnector'], true)) {
            $this->decide('review', 'commercial_seller_unavailable');
        }

        return ['lead' => $lead, 'deal' => $deal, 'seller_id' => $seller, 'contact_id' => $contact, 'contact' => $contactRecord];
    }

    private function validateLead(mixed $lead, object $receipt): void
    {
        if (! is_array($lead) || (string) ($lead['ID'] ?? '') !== (string) $receipt->lead_id
            || (new WebFormReceipt)->identityHash((string) ($lead['UF_CRM_1693840106704'] ?? '')) !== $receipt->identity_hash
            || ! $this->id($lead['CONTACT_ID'] ?? null)
            || ($receipt->contact_id && (string) $lead['CONTACT_ID'] !== (string) $receipt->contact_id)) {
            $this->decide('review', 'web_crm_identity_changed');
        }
        if (($lead['STATUS_SEMANTIC_ID'] ?? '') === 'F') {
            $this->decide('review', 'web_case_rejected');
        }
    }

    private function nativeIdentity(object $receipt, array $target, ?array $before = null): ?array
    {
        $id = $this->proof['native_lead_id'] ?? null;
        if (! $this->id($id)) {
            return null;
        }
        $lead = $this->call('crm.lead.get', ['id' => $id]);
        if (! is_array($lead) || (string) ($lead['ID'] ?? '') !== (string) $id) {
            $this->decide('review', 'native_crm_unavailable');
        }
        $identity = (string) ($lead['UF_CRM_1693840106704'] ?? '');
        if (($identity !== '' && (new WebFormReceipt)->identityHash($identity) !== $receipt->identity_hash)
            || (! empty($lead['CONTACT_ID']) && (string) $lead['CONTACT_ID'] !== $target['contact_id'])) {
            $this->decide('review', 'native_crm_identity_conflict');
        }
        $owner = (string) ($lead['ASSIGNED_BY_ID'] ?? '');
        $creator = (string) ($lead['CREATED_BY_ID'] ?? '');
        // A provisional-looking owner can be a later human assignment. Admit
        // only the expected native receiver/creator pair as corroboration; this
        // does not prove the initial owner or replace the live attention checks.
        $nativeReceiver = in_array($creator, ['57', '74827'], true) && $owner === $creator;
        if ((! in_array($owner, ['0', '', $target['seller_id']], true) && ! $nativeReceiver)
            || ($before && $owner !== (string) ($before['ASSIGNED_BY_ID'] ?? ''))) {
            $this->decide('preserved', 'native_crm_assignment_preserved');
        }

        return $lead;
    }

    private function bindings(): array
    {
        $bindings = $this->call('crm.activity.binding.list', ['activityId' => (int) $this->proof['activity_id']]);
        if (! is_array($bindings) || ! array_is_list($bindings)) {
            $this->decide('waiting', 'activity_bindings_unavailable');
        }

        return $bindings;
    }

    private function hasBinding(array $bindings, int $type, int $id): bool
    {
        return collect($bindings)->contains(fn ($b) => (int) ($b['entityTypeId'] ?? 0) === $type && (string) ($b['entityId'] ?? '') === (string) $id);
    }

    private function link(int $dealId, int $contactId): void
    {
        $bindings = $this->bindings();
        if (collect($bindings)->contains(fn ($b) => (int) ($b['entityTypeId'] ?? 0) === 3 && (string) ($b['entityId'] ?? '') !== (string) $contactId)) {
            $this->decide('review', 'activity_already_bound_to_another_contact');
        }
        if (collect($bindings)->contains(fn ($b) => (int) ($b['entityTypeId'] ?? 0) === 2 && (string) ($b['entityId'] ?? '') !== (string) $dealId)) {
            $this->decide('review', 'activity_already_bound_to_another_deal');
        }
        foreach ([[3, $contactId], [2, $dealId]] as [$type, $id]) {
            if ($this->hasBinding($bindings, $type, $id)) {
                continue;
            }
            $this->write(['link_state' => 'linking']);
            $this->assertLease();
            try {
                $this->call('crm.activity.binding.add', ['activityId' => (int) $this->proof['activity_id'], 'entityTypeId' => $type, 'entityId' => $id]);
            } catch (Throwable) {
                // Binding the same activity/object is idempotent, but always read back
                // before deciding whether another attempt is necessary.
            }
            $bindings = $this->bindings();
            if (! $this->hasBinding($bindings, $type, $id)) {
                $this->decide('waiting', 'activity_binding_not_confirmed');
            }
            if (collect($bindings)->contains(fn ($b) => (int) ($b['entityTypeId'] ?? 0) === 2 && (string) ($b['entityId'] ?? '') !== (string) $dealId)) {
                $this->decide('review', 'activity_binding_conflict');
            }
            if (collect($bindings)->contains(fn ($b) => (int) ($b['entityTypeId'] ?? 0) === 3 && (string) ($b['entityId'] ?? '') !== (string) $contactId)) {
                $this->decide('review', 'activity_contact_conflict');
            }
        }
    }

    private function finalCheck(object $receipt, array $target, array $attention, ?array $native): void
    {
        $commands = ['lead' => 'crm.lead.get?id='.$receipt->lead_id, 'deal' => 'crm.deal.get?id='.$target['deal']['ID'],
            'contact' => 'crm.contact.get?id='.$target['contact_id']];
        if ($native) {
            $commands['native'] = 'crm.lead.get?id='.$native['ID'];
        }
        $commands['dialog'] = 'imopenlines.dialog.get?CHAT_ID='.$this->proof['chat_id'];
        $data = $this->call('batch', ['cmd' => $commands, 'halt' => 0]);
        if (! is_array($data) || ! empty($data['result_error']) || ! isset($data['result']['lead'], $data['result']['deal'], $data['result']['contact'], $data['result']['dialog'])) {
            $this->decide('waiting', 'final_assignment_check_unavailable');
        }
        $result = $data['result'];
        $this->validateLead($result['lead'], $receipt);
        $this->validateDialogCase($result['dialog'], $target);
        if ((string) ($result['dialog']['entity_data_2'] ?? '') !== (string) ($attention['dialog']['entity_data_2'] ?? '')) {
            $this->decide('preserved', 'native_crm_binding_changed');
        }
        foreach (['ID', 'ASSIGNED_BY_ID', 'LEAD_ID', 'CONTACT_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID'] as $field) {
            if ((string) ($result['deal'][$field] ?? '') !== (string) ($target['deal'][$field] ?? '')) {
                $this->decide('preserved', 'commercial_assignment_changed');
            }
        }
        if ((string) ($result['lead']['ASSIGNED_BY_ID'] ?? '') !== $target['seller_id']
            || (string) ($result['contact']['ID'] ?? '') !== $target['contact_id']
            || (string) ($result['contact']['ASSIGNED_BY_ID'] ?? '') !== (string) ($target['contact']['ASSIGNED_BY_ID'] ?? '')
            || (new WebFormReceipt)->identityHash((string) ($result['contact']['UF_CRM_65B7E48033FCD'] ?? '')) !== $receipt->identity_hash
            || ($native && (string) ($result['native']['ASSIGNED_BY_ID'] ?? '') !== (string) $native['ASSIGNED_BY_ID'])) {
            $this->decide('preserved', 'crm_assignment_changed');
        }
        if ($native) {
            $identity = (string) ($result['native']['UF_CRM_1693840106704'] ?? '');
            if ((string) ($result['native']['ID'] ?? '') !== (string) $native['ID']
                || ($identity !== '' && (new WebFormReceipt)->identityHash($identity) !== $receipt->identity_hash)
                || (! empty($result['native']['CONTACT_ID']) && (string) $result['native']['CONTACT_ID'] !== $target['contact_id'])) {
                $this->decide('preserved', 'native_crm_identity_changed');
            }
        }
        $parts = explode('|', (string) ($result['dialog']['entity_data_1'] ?? ''));
        if ((string) ($result['dialog']['id'] ?? '') !== (string) $this->proof['chat_id']
            || (string) ($parts[5] ?? '') !== (string) $this->proof['session_id']
            || (string) ($result['dialog']['owner'] ?? 0) !== (string) $attention['owner_id']
            || ! in_array($result['dialog']['text_field_enabled'] ?? null, [true, 'Y', 1], true)) {
            $this->decide('preserved', 'chat_assignment_changed');
        }
    }

    private function reconcileTransfer(object $route): array
    {
        $intent = $this->proof['transfer_intent'] ?? null;
        if (! is_array($intent) || ! $this->id($intent['seller_id'] ?? null)) {
            return $this->finish('review', 'transfer_intent_unavailable', ['transfer_state' => 'unknown']);
        }
        $dialog = $this->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $this->proof['chat_id']]);
        $parts = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
        $owner = (string) ($dialog['owner'] ?? 0);
        if ((string) ($parts[5] ?? '') !== (string) $intent['session_id']) {
            return $this->finish('preserved', 'session_changed_after_transfer', ['transfer_state' => 'unknown']);
        }
        if ($owner === (string) $intent['seller_id']) {
            $deal = $this->call('crm.deal.get', ['id' => $route->deal_id]);
            $lead = $this->call('crm.lead.get', ['id' => $intent['web_lead_id']]);
            $contact = $this->call('crm.contact.get', ['id' => $intent['contact_id']]);
            if ((string) ($deal['ASSIGNED_BY_ID'] ?? '') !== $owner
                || (string) ($lead['ASSIGNED_BY_ID'] ?? '') !== $owner
                || (string) ($contact['ASSIGNED_BY_ID'] ?? '') !== (string) $intent['contact_owner_before']) {
                return $this->finish('review', 'crm_responsible_changed_after_transfer', ['transfer_state' => 'confirmed']);
            }
            if ($this->id($intent['native_lead_id'] ?? null)) {
                $native = $this->call('crm.lead.get', ['id' => $intent['native_lead_id']]);
                if (! in_array((string) ($native['ASSIGNED_BY_ID'] ?? ''), [(string) $intent['native_owner_before'], $owner], true)) {
                    return $this->finish('preserved', 'native_responsible_changed_after_transfer', ['transfer_state' => 'observed']);
                }
            }
            $acknowledged = ($this->proof['transfer_acknowledged'] ?? false) === true;

            return $this->finish('routed', $acknowledged ? 'assigned_seller_confirmed' : 'assigned_seller_observed_after_uncertain_post',
                ['transfer_state' => $acknowledged ? 'confirmed' : 'observed']);
        }
        if ($owner !== (string) $intent['owner_before'] && $owner !== '0') {
            return $this->finish('preserved', 'human_assignment_after_transfer', ['transfer_state' => 'unknown']);
        }

        return $this->finish($route->attempts >= 12 ? 'review' : 'unknown', 'transfer_result_uncertain', ['transfer_state' => 'unknown']);
    }

    private function validateProof(object $entry): void
    {
        if (($this->proof['verified'] ?? null) !== true || ($this->proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($this->proof['evidence'] ?? '') !== 'external_message_id'
            || (int) ($this->proof['entry_event_id'] ?? 0) !== (int) $entry->id
            || (string) ($this->proof['entry_message_id'] ?? '') !== (string) $entry->message_id) {
            $this->decide('review', 'native_proof_mismatch');
        }
        foreach (['chat_id', 'session_id', 'message_id', 'activity_id'] as $field) {
            if (! $this->id($this->proof[$field] ?? null)) {
                $this->decide('review', 'native_proof_incomplete');
            }
        }
    }

    private function preserveAttention(array $attention, string $seller): array
    {
        if ((int) $attention['owner_id'] > 0 && (string) $attention['owner_id'] !== $seller) {
            $this->proof['protected_assignment'] = true;
            $this->proof['protected_owner_id'] = (string) $attention['owner_id'];
            unset($this->proof['protection_released']);
            // Persist the terminal state with its protection marker: a crash
            // before finish() must not hide it from subsequent chat messages.
            $this->write(['proof' => json_encode($this->proof, JSON_THROW_ON_ERROR),
                'state' => 'preserved', 'reason' => $attention['reason'], 'transfer_state' => 'preserved']);
        }

        return $this->finish('preserved', $attention['reason'], ['transfer_state' => 'preserved']);
    }

    private function validateDialogCase(mixed $dialog, array $target): void
    {
        if (! is_array($dialog)) {
            $this->decide('waiting', 'native_crm_binding_unavailable');
        }
        $channel = explode('|', (string) ($dialog['entity_id'] ?? ''));
        $sender = explode('@', $channel[2] ?? '');
        if (($channel[0] ?? '') !== 'whatsappbyedna' || ($channel[1] ?? '') !== '1'
            || ($sender[1] ?? '') !== (string) config('edna.subject_id')
            || (new AttributionJourney)->phoneHash($sender[0] ?? '') !== $this->phoneHash) {
            $this->decide('preserved', 'native_channel_identity_changed');
        }
        $parts = explode('|', (string) ($dialog['entity_data_2'] ?? ''));
        $links = [];
        for ($i = 0; $i + 1 < count($parts); $i += 2) {
            $links[$parts[$i]] = $parts[$i + 1];
        }
        if (! array_key_exists('LEAD', $links) || ! array_key_exists('CONTACT', $links) || ! array_key_exists('DEAL', $links)) {
            $this->decide('waiting', 'native_crm_binding_incomplete');
        }
        if (($this->id($links['CONTACT']) && $links['CONTACT'] !== $target['contact_id'])
            || ($this->id($links['DEAL']) && $links['DEAL'] !== (string) $target['deal']['ID'])
            || ($this->id($links['LEAD']) && ! in_array($links['LEAD'], [(string) ($this->proof['native_lead_id'] ?? ''), (string) $target['lead']['ID']], true))) {
            $this->decide('preserved', 'native_crm_case_preserved');
        }
    }

    private function claim(): ?object
    {
        return DB::transaction(function () {
            $row = DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)->lockForUpdate()->first();
            if (! $row || in_array($row->state, ['routed', 'linked', 'preserved', 'review'], true)
                || ($row->lease_until && CarbonImmutable::parse($row->lease_until)->isFuture())
                || ($row->available_at && CarbonImmutable::parse($row->available_at)->isFuture())) {
                return null;
            }
            $token = (string) Str::uuid();
            DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)->update([
                'lease_token' => $token, 'lease_until' => now()->addSeconds(120), 'attempts' => $row->attempts + 1,
                'enqueued_at' => null, 'updated_at' => now(),
            ]);

            return DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)->first();
        });
    }

    private function assertLease(): void
    {
        if (microtime(true) >= $this->deadline || ! DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)
            ->where('lease_token', $this->token)->where('lease_until', '>', now())->exists()) {
            $this->decide('waiting', 'routing_lease_expired');
        }
    }

    private function write(array $fields): void
    {
        $this->assertLease();
        if (DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)->where('lease_token', $this->token)
            ->update($fields + ['updated_at' => now()]) !== 1) {
            $this->decide('waiting', 'routing_lease_superseded');
        }
    }

    private function call(string $method, array $params = []): mixed
    {
        $this->assertLease();

        return $this->crm->call($method, $params);
    }

    private function finish(string $state, string $reason, array $fields = []): array
    {
        if ($state === 'preserved' && ! isset($fields['transfer_state'])) {
            $fields['transfer_state'] = 'preserved';
        }
        $updated = DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)->where('lease_token', $this->token)->update($fields + [
            'state' => $state, 'reason' => $reason, 'lease_token' => null, 'lease_until' => null,
            'available_at' => now()->addSeconds($state === 'unknown' ? 300 : 60), 'updated_at' => now(),
        ]);
        if ($updated !== 1) {
            return ['state' => 'superseded', 'reason' => 'routing_lease_superseded'];
        }
        try {
            $row = DB::table('web_form_chat_routes')->where('entry_event_id', $this->entryId)->first();
            app(JourneyLedger::class)->record('whatsapp.web_chat_route', [
                'entry_event_id' => $this->entryId, 'chat_id' => $this->proof['chat_id'] ?? null,
                'native_session_id' => $this->proof['session_id'] ?? null, 'seller_id' => $row->seller_id,
                'state' => $state, 'reason' => $reason, 'link_state' => $row->link_state,
                'transfer_state' => $row->transfer_state, 'transfer_intent' => $this->proof['transfer_intent'] ?? null,
                'transfer_acknowledged' => ($this->proof['transfer_acknowledged'] ?? false) === true,
            ], array_filter(['submission_id' => $row->submission_id, 'deal_id' => $row->deal_id]), 'whatsapp.web_chat');
            app(JourneyLedger::class)->flush();
        } catch (Throwable) {
            // The durable route remains the primary receipt. A tracking failure
            // must never replay a completed or uncertain external transfer.
        }

        return ['state' => $state, 'reason' => $reason];
    }

    private function decide(string $state, string $reason): never
    {
        throw new WebFormChatDecision($state, $reason);
    }

    private function id(mixed $value): bool
    {
        return (is_string($value) || is_int($value)) && preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value) === 1;
    }
}
