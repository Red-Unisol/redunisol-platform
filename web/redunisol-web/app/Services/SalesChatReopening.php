<?php

namespace App\Services;

use App\Support\BitrixSellerRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Read-only decision for a new VENTAS session following a closed, attended loan session. */
class SalesChatReopening
{
    private const DEAL_FIELDS = ['ID', 'LEAD_ID', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CLOSED', 'ASSIGNED_BY_ID'];

    public function __construct(private readonly EdnaBitrix $crm) {}

    public function decide(object $entry, array $payload, array $proof): ?array
    {
        $intent = $this->intent($payload);
        if (! $intent || ($payload['id'] ?? null) !== $entry->message_id || ($payload['subjectId'] ?? null) !== $entry->subject_id
            || $entry->subject_id !== (string) config('edna.subject_id')) {
            return null;
        }
        $opened = null;
        try {
            $hash = (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
            if (! $hash || ($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
                || ($proof['evidence'] ?? '') !== 'external_message_id' || (string) ($proof['entry_event_id'] ?? '') !== (string) $entry->id
                || (string) ($proof['entry_message_id'] ?? '') !== $entry->message_id
                || ! $this->id($proof['chat_id'] ?? null) || ! $this->id($proof['session_id'] ?? null)
                || ! $this->id($proof['activity_id'] ?? null) || ! $this->id($proof['message_id'] ?? null)) {
                return $this->decision('retry', 'reopening_native_proof_unavailable');
            }
            // A short negative by itself does not warrant searching Bitrix for an unrelated customer.
            if ($intent === 'negative' && ! app(WebFormChatRouting::class)->history($hash)->exists()
                && ! DB::table('edna_assistance_form_receipts')->where('phone_hash', $hash)->exists()
                && ! DB::table('edna_customer_profiles')->where('phone_hash', $hash)->exists()) {
                return null;
            }
            $received = $this->date($payload['receivedAt'] ?? null);
            if ($received->gt(now()) || $received->addDay()->lte(now())) {
                return $this->decision('hold', 'reopening_customer_window_inactive');
            }
            $dialog = $this->crm->call('imopenlines.dialog.get', ['CHAT_ID' => (int) $proof['chat_id']]);
            $session = explode('|', (string) ($dialog['entity_data_1'] ?? ''));
            if ((string) ($dialog['id'] ?? '') !== (string) $proof['chat_id'] || ($dialog['entity_type'] ?? '') !== 'LINES'
                || count($session) < 7 || ! array_key_exists('text_field_enabled', $dialog)) {
                return $this->decision('retry', 'reopening_dialog_unavailable');
            }
            if ((string) $proof['session_id'] !== $session[5] || ! in_array($dialog['text_field_enabled'], [true, 'Y', 1, '1'], true)) {
                return $this->decision('hold', 'reopening_session_replaced_or_closed');
            }
            $tuple = app(EdnaOrganicAttention::class)->dialogTuple($dialog, $proof);
            $opened = CarbonImmutable::createFromTimestampUTC((int) $tuple['session_epoch'])->toIso8601String();
            $source = explode('|', $dialog['entity_id']);
            [$nativePhone] = explode('@', $source[2]);
            if ((new AttributionJourney)->phoneHash($nativePhone) !== $hash) {
                return $this->decision('clarify', 'reopening_native_recipient_changed', $opened);
            }
            $at = $this->date($opened);
            $previous = $this->previous($proof, $at->subMinutes(10), $at);
            if (! $previous && $intent === 'status') {
                $previous = $this->previousFromReceipt($proof, $hash, (int) $entry->id);
            }
            if (! $previous) {
                return null;
            }
            $previousDeal = match (strtolower((string) ($previous['crmEntityType'] ?? ''))) {
                'deal' => $this->id($previous['crmEntityId'] ?? null),
                default => null,
            };
            // An exact local session/submission can establish the previous loan even when Bitrix
            // retained a lead on the closed session. A telephone match alone never selects a case.
            $routes = app(WebFormChatRouting::class)->history($hash)->whereNotNull('deal_id')
                ->where('entry_event_id', '<', (int) $entry->id)->where('proof->chat_id', (string) $proof['chat_id'])
                ->where('proof->session_id', (string) $previous['id'])->limit(21)->get();
            if ($routes->count() > 20) {
                return $this->decision('clarify', 'reopening_previous_case_ambiguous', $opened);
            }
            $dealIds = $previousDeal ? [$previousDeal] : [];
            foreach ($routes as $route) {
                if (app(WebFormChatRouting::class)->validHistory($route) && $this->id($route->deal_id)) {
                    $dealIds[] = (string) $route->deal_id;
                }
            }
            $dealIds = array_values(array_unique($dealIds));
            if (! $dealIds) {
                return null;
            }
            if (count($dealIds) !== 1) {
                return $this->decision('clarify', 'reopening_previous_case_ambiguous', $opened);
            }
            $deal = $this->crm->call('crm.deal.get', ['id' => $dealIds[0]]);
            if (! is_array($deal) || (string) ($deal['ID'] ?? '') !== $dealIds[0]) {
                throw new RuntimeException('Incomplete deal response.');
            }
            foreach (self::DEAL_FIELDS as $field) {
                if (! array_key_exists($field, $deal)) {
                    throw new RuntimeException('Incomplete deal response.');
                }
            }
            if ((string) $deal['CATEGORY_ID'] !== '1' || $deal['CLOSED'] !== 'N' || $deal['STAGE_SEMANTIC_ID'] !== 'P'
                || isset(EdnaRejectedDealDiscovery::STAGE_REASONS[$deal['STAGE_ID']])) {
                return null;
            }
            $contact = $this->id($deal['CONTACT_ID'] ?? null);
            $lead = $this->id($deal['LEAD_ID'] ?? null);
            if (! $contact || ! $lead || ! $this->sameCase($tuple, $lead, $contact, $dealIds[0])) {
                return $this->decision('clarify', 'reopening_identity_unconfirmed', $opened);
            }
            foreach ($routes as $route) {
                if (! app(WebFormChatRouting::class)->validHistory($route)) {
                    continue;
                }
                $receipt = DB::table('web_form_receipts')->find($route->submission_id);
                if (! $receipt || $receipt->state !== 'synced' || $receipt->source !== 'web_server'
                    || $receipt->phone_hash !== $hash || (string) $receipt->lead_id !== $lead
                    || ($receipt->contact_id && (string) $receipt->contact_id !== $contact)) {
                    return $this->decision('clarify', 'reopening_receipt_case_changed', $opened);
                }
            }
            $open = $this->crm->call('crm.deal.list', ['filter' => ['=CONTACT_ID' => $contact, '=CATEGORY_ID' => 1, '=CLOSED' => 'N',
                '=STAGE_SEMANTIC_ID' => 'P'], 'select' => self::DEAL_FIELDS, 'start' => -1]);
            if (! is_array($open) || ! array_is_list($open)) {
                throw new RuntimeException('Incomplete open loan response.');
            }
            $ids = [];
            $owners = [];
            foreach ($open as $row) {
                if (! $this->id($row['ID'] ?? null) || (string) ($row['CONTACT_ID'] ?? '') !== $contact
                    || (string) ($row['CATEGORY_ID'] ?? '') !== '1' || ($row['CLOSED'] ?? '') !== 'N' || ($row['STAGE_SEMANTIC_ID'] ?? '') !== 'P') {
                    throw new RuntimeException('Unverified open loan.');
                }
                if ((string) $row['ID'] === $dealIds[0]) {
                    foreach (self::DEAL_FIELDS as $field) {
                        if ((string) ($row[$field] ?? '') !== (string) ($deal[$field] ?? '')) {
                            return $this->decision('retry', 'reopening_deal_changed_during_inspection', $opened);
                        }
                    }
                }
                $ids[] = (string) $row['ID'];
                $owners[(string) $row['ID']] = str_starts_with((string) ($row['STAGE_ID'] ?? ''), 'C1:')
                    && ! str_starts_with($row['STAGE_ID'], 'C1:KESTRA_') && ! isset(EdnaRejectedDealDiscovery::STAGE_REASONS[$row['STAGE_ID']])
                    ? $this->id($row['ASSIGNED_BY_ID'] ?? null) : null;
            }

            return $this->evaluate($payload, $proof, ['previous_session' => $previous, 'current_opened_at' => $opened,
                'deal' => $deal, 'deal_id' => $dealIds[0], 'lead_id' => $lead, 'contact_id' => $contact,
                'open_loan_ids' => $ids, 'open_loan_owners' => count($open) < 50 ? $owners : [],
                'eligible_sellers' => app(BitrixSellerRegistry::class)->enabledIds(),
                'dialog_fingerprint' => $this->fingerprint($tuple)]);
        } catch (Throwable) {
            return $this->decision('retry', 'reopening_lookup_unavailable', $opened);
        }
    }

    /** Same decision for a reconstructed historical snapshot and a live, verified read. */
    public function evaluate(array $payload, array $proof, array $case): ?array
    {
        $intent = $this->intent($payload);
        $previous = $case['previous_session'];
        $opened = $case['current_opened_at'];
        $deal = $case['deal'];
        if (! $intent || (string) $previous['id'] === (string) $proof['session_id'] || (string) $previous['chatId'] !== (string) $proof['chat_id']
            || (string) $previous['configId'] !== '1' || $previous['status'] !== 'closed' || ! $this->id($previous['operatorId'] ?? null)
            || in_array((string) $previous['operatorId'], ['57', '74827', '71283'], true)
            || empty($previous['dateClose']) || empty($previous['dateFirstAnswer'])) {
            return null;
        }
        $closed = $this->date($previous['dateClose']);
        $openedAt = $this->date($opened);
        $received = $this->date($payload['receivedAt']);
        if ($this->date($previous['dateFirstAnswer'])->gt($closed) || $closed->gt($openedAt)
            || $openedAt->gt($received->addSeconds(10))) {
            return null;
        }
        $evidence = ['previous_session_id' => (string) $previous['id'], 'previous_closed_at' => $closed->toIso8601String(),
            'lead_id' => (string) $case['lead_id'], 'contact_id' => (string) $case['contact_id'],
            'dialog_fingerprint' => $case['dialog_fingerprint'] ?? null];
        if ((string) $deal['ID'] !== (string) $case['deal_id'] || (string) $deal['LEAD_ID'] !== (string) $case['lead_id']
            || (string) $deal['CONTACT_ID'] !== (string) $case['contact_id'] || (string) $deal['CATEGORY_ID'] !== '1'
            || $deal['CLOSED'] !== 'N' || $deal['STAGE_SEMANTIC_ID'] !== 'P' || isset(EdnaRejectedDealDiscovery::STAGE_REASONS[$deal['STAGE_ID']])) {
            return null;
        }
        $seller = $this->id($deal['ASSIGNED_BY_ID'] ?? null);
        $ids = array_map('strval', $case['open_loan_ids']);
        $owners = $case['open_loan_owners'] ?? [];
        if (! in_array((string) $deal['ID'], $ids, true) || (count($ids) > 1 && (! $seller || count($owners) !== count($ids)
            || array_values(array_unique($owners)) !== [$seller]))) {
            return $this->decision('clarify', 'reopening_open_loan_ambiguous', $opened) + $evidence;
        }
        if ($intent === 'negative') {
            return ($previous['closeReason'] ?? '') === 'operator'
                && $closed->addMinutes(10)->gte($openedAt) && $openedAt->addMinutes(10)->gte($received)
                ? $this->decision('hold', 'reopening_short_decline', $opened) + $evidence : null;
        }
        if (! (new SalesChatRoutingPolicy)->commercialTarget($seller)
            || ! str_starts_with($deal['STAGE_ID'], 'C1:') || str_starts_with($deal['STAGE_ID'], 'C1:KESTRA_')
            || ! in_array($seller, array_map('strval', $case['eligible_sellers']), true)) {
            return $this->decision('retry', 'reopening_waiting_current_seller', $opened) + $evidence;
        }

        return ['action' => 'route', 'reason' => 'reopening_current_deal_seller', 'seller_id' => $seller, 'deal_id' => (string) $deal['ID'],
            'current_session_started_at' => $opened] + $evidence;
    }

    /** Revalidate the same native primary, secondary bindings and connector immediately before the transfer. */
    public function matchesDestinationDialog(array $decision, array $dialog, array $proof): bool
    {
        try {
            $tuple = app(EdnaOrganicAttention::class)->dialogTuple($dialog, $proof);

            return ($decision['action'] ?? '') === 'route' && is_string($decision['dialog_fingerprint'] ?? null)
                && hash_equals($decision['dialog_fingerprint'], $this->fingerprint($tuple))
                && $this->sameCase($tuple, $decision['lead_id'], $decision['contact_id'], $decision['deal_id']);
        } catch (Throwable) {
            return false;
        }
    }

    private function previousFromReceipt(array $proof, string $hash, int $entryId): ?array
    {
        $history = app(WebFormChatRouting::class);
        $route = $history->history($hash)->where('proof->chat_id', (string) $proof['chat_id'])
            ->where('proof->session_id', '!=', (string) $proof['session_id'])->where('entry_event_id', '<', $entryId)
            ->whereNotNull('deal_id')->orderByDesc('entry_event_id')->first();
        if (! $route || ! $history->validHistory($route)) {
            return null;
        }
        $before = json_decode($route->proof, true, 16, JSON_THROW_ON_ERROR);
        $activity = $this->crm->call('crm.activity.get', ['id' => $before['activity_id']]);
        if ((string) ($activity['ID'] ?? '') !== (string) $before['activity_id'] || ($activity['PROVIDER_ID'] ?? '') !== 'IMOPENLINES_SESSION'
            || (string) ($activity['ASSOCIATED_ENTITY_ID'] ?? '') !== (string) $before['session_id']) {
            throw new RuntimeException('Invalid historical activity.');
        }
        $start = $this->date($activity['START_TIME'] ?? null);

        return $this->previous($proof, $start->subSeconds(30), $start->addSeconds(30), (string) $before['session_id']);
    }

    private function previous(array $proof, CarbonImmutable $from, CarbonImmutable $to, ?string $knownId = null): ?array
    {
        $matches = [];
        $seen = [];
        $field = $knownId ? 'dateCreate' : 'dateClose';
        for ($offset = 0; $offset < 1000;) {
            $data = $this->crm->call('imopenlines.v2.Session.list', ['configId' => 1, $field.'From' => $from->toIso8601String(),
                $field.'To' => $to->toIso8601String(), 'limit' => 200, 'offset' => $offset, 'order' => 'dateCreate', 'orderDirection' => 'desc']);
            if (! is_bool($data['hasNextPage'] ?? null) || ! is_array($data['sessions'] ?? null) || ! array_is_list($data['sessions'])) {
                throw new RuntimeException('Incomplete closed session window.');
            }
            foreach ($data['sessions'] as $row) {
                $id = $this->id($row['id'] ?? null);
                if (! $id || isset($seen[$id])) {
                    throw new RuntimeException('Invalid closed session page.');
                }
                $seen[$id] = true;
                if ((string) ($row['chatId'] ?? '') === (string) $proof['chat_id'] && (string) ($row['configId'] ?? '') === '1'
                    && (string) $proof['session_id'] !== $id && ($row['status'] ?? '') === 'closed' && ! empty($row['dateClose'])) {
                    $closed = $this->date($row['dateClose']);
                    if (($knownId === null || $id === $knownId) && $this->date($row[$field])->betweenIncluded($from, $to)) {
                        if (isset($matches[$closed->getTimestamp()])) {
                            throw new RuntimeException('Closed session order ambiguous.');
                        }
                        $matches[$closed->getTimestamp()] = $row;
                    }
                }
            }
            if (! $data['hasNextPage']) {
                krsort($matches, SORT_NUMERIC);

                return $matches ? reset($matches) : null;
            }
            if (! $data['sessions']) {
                break;
            }
            $offset += count($data['sessions']);
        }
        throw new RuntimeException('Closed session read budget exhausted.');
    }

    private function fingerprint(array $tuple): string
    {
        unset($tuple['owner']); // Current human attention is protected by the native transfer guard.

        return hash('sha256', json_encode($tuple, JSON_THROW_ON_ERROR));
    }

    private function sameCase(array $tuple, string $lead, string $contact, string $deal): bool
    {
        $expected = ['contact' => $contact, 'lead' => $lead, 'deal' => $deal];
        $bindings = $tuple['bindings'];
        if ($tuple['primary_id'] !== '') {
            $bindings[$tuple['primary_entity']] = $tuple['primary_id'];
        }
        foreach ($bindings as $type => $id) {
            if (($expected[$type] ?? null) !== $id) {
                return false;
            }
        }

        return $bindings !== [];
    }

    private function intent(array $payload): ?string
    {
        $message = $payload['messageContent'] ?? [];
        if (($message['type'] ?? '') !== 'TEXT' || ! is_string($message['text'] ?? null) || isset($message['referral'])
            || ! empty($payload['replyOutMessageId']) || ! empty($payload['replyOutMessageExternalRequestId'])) {
            return null;
        }
        $text = trim((string) preg_replace('/[^a-z0-9]+/', ' ', strtolower(Str::ascii($message['text']))));
        if (in_array($text, ['no', 'hoy no', 'no gracias', 'hoy no gracias', 'por ahora no', 'ahora no', 'no por ahora'], true)) {
            return 'negative';
        }
        $status = '/^(?:hola )?(?:(?:quiero|queria|quisiera|necesito) )?(?:(?:consultar|preguntar|averiguar|saber)(?: por| sobre)? )?(?:(?:que paso con|como (?:va|esta|sigue)|el estado de) )?mi (?:solicitud|tramite)(?: (?:de (?:prestamo|credito)|de ayer|por favor))?$/D';

        return preg_match($status, $text) ? 'status' : null;
    }

    private function date(mixed $value): CarbonImmutable
    {
        if (! is_string($value) || ! preg_match('/(?:Z|[+-]\d{2}:\d{2})$/D', $value)) {
            throw new RuntimeException('Missing native timestamp.');
        }

        return CarbonImmutable::parse($value);
    }

    private function id(mixed $value): ?string
    {
        return (is_string($value) || is_int($value)) && preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value) ? (string) $value : null;
    }

    private function decision(string $action, string $reason, ?string $opened = null): array
    {
        return ['action' => $action, 'reason' => $reason, 'seller_id' => '', 'deal_id' => '', 'current_session_started_at' => $opened];
    }
}
