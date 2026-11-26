<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class EdnaRejectedDealDiscovery
{
    public const CUTOVER = 'rejected-deal-chat-close-v1';

    // Only terminal deal stages with an independently verified rejection notice.
    public const STAGE_REASONS = ['C1:5' => 'SIT NEG BCRA'];

    public static function cutover(): ?object
    {
        return DB::table('edna_intake_cutovers')->where('name', self::CUTOVER)->first();
    }

    public static function afterCutover(mixed $nativeTimestamp, object $cut): bool
    {
        if (! is_string($nativeTimestamp) || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/D', $nativeTimestamp)) {
            return false;
        }
        try {
            $date = CarbonImmutable::parse($nativeTimestamp);
            $errors = $date->getLastErrors();

            return (! $errors || (! $errors['warning_count'] && ! $errors['error_count']))
                && $date->gte(CarbonImmutable::parse($cut->starts_at, 'UTC')) && $date->lte(now());
        } catch (Throwable) {
            return false;
        }
    }

    public static function eligibleDeal(array $deal, object $cut): bool
    {
        return (string) ($deal['CATEGORY_ID'] ?? '') === '1'
            && isset(self::STAGE_REASONS[$deal['STAGE_ID'] ?? ''])
            && ($deal['STAGE_SEMANTIC_ID'] ?? '') === 'F' && ($deal['CLOSED'] ?? '') === 'Y'
            && self::afterCutover($deal['DATE_CREATE'] ?? null, $cut)
            && self::afterCutover($deal['MOVED_TIME'] ?? null, $cut);
    }

    /** Key by candidate index: two sessions for the same lead can straddle the cutover. */
    public function discover(EdnaBitrix $crm, array $candidates): array
    {
        $cut = self::cutover();
        if (! $cut || ! $candidates) {
            return [];
        }
        $entryIds = array_column(array_column($candidates, 'proof'), 'entry_event_id');
        $entries = DB::table('edna_incoming_events')->whereIntegerInRaw('id', $entryIds)
            ->where('id', '>', $cut->entry_id_after)->where('created_at', '>=', CarbonImmutable::parse($cut->starts_at, 'UTC'))
            ->get(['id', 'message_id', 'subject_id', 'payload'])->keyBy('id');
        $fresh = [];
        $freshIntake = app(EdnaFreshIntake::class);
        foreach ($candidates as $index => $candidate) {
            if ($candidate['source_type'] === 'web_form_chat_route' && ! self::afterCutover($candidate['form_received_at'] ?? null, $cut)) {
                continue;
            }
            $proof = $candidate['proof'];
            $entry = $entries->get($proof['entry_event_id'] ?? 0);
            if ($entry && (string) $entry->message_id === (string) ($proof['entry_message_id'] ?? '')
                && (string) ($proof['native_lead_id'] ?? $candidate['lead_id']) === (string) $candidate['lead_id']
                && (string) ($proof['lead_id'] ?? $candidate['lead_id']) === (string) $candidate['lead_id']
                && $freshIntake->entryAfter($entry, $cut)) {
                $fresh[$index] = (string) $candidate['lead_id'];
            }
        }
        $deals = [];
        foreach (array_chunk(array_unique($fresh), 50) as $leadIds) {
            $deals += $this->uniqueDeals($crm, $leadIds, $cut);
        }

        $result = [];
        foreach ($fresh as $index => $leadId) {
            if (isset($deals[$leadId])) {
                $result[$index] = $deals[$leadId];
            }
        }

        return $result;
    }

    private function uniqueDeals(EdnaBitrix $crm, array $leadIds, object $cut): array
    {
        $deals = [];
        $lastId = 0;
        // Page ALL deals for these leads, including open deals and other pipelines.
        // Never infer uniqueness from a stage-filtered result or an incomplete scan.
        for ($page = 0; $page < 20; $page++) {
            $rows = $crm->call('crm.deal.list', ['filter' => ['@LEAD_ID' => $leadIds, '>ID' => $lastId],
                'select' => ['ID', 'LEAD_ID', 'CATEGORY_ID', 'STAGE_ID', 'CLOSED', 'STAGE_SEMANTIC_ID', 'DATE_CREATE', 'MOVED_TIME'],
                'order' => ['ID' => 'ASC'], 'start' => 0]);
            if (! is_array($rows) || ! array_is_list($rows) || count($rows) > 50) {
                throw new RuntimeException('Rejected deal discovery is incomplete.');
            }
            foreach ($rows as $row) {
                $lead = (string) ($row['LEAD_ID'] ?? '');
                $id = (string) ($row['ID'] ?? '');
                if (! in_array($lead, $leadIds, true) || ! preg_match('/^[1-9]\d{0,17}$/D', $id) || (int) $id <= $lastId) {
                    throw new RuntimeException('Unexpected deal in rejection discovery.');
                }
                $lastId = (int) $id;
                $deals[$lead] = ! array_key_exists($lead, $deals) && self::eligibleDeal($row, $cut) ? $id : null;
            }
            if (count($rows) < 50) {
                return array_filter($deals);
            }
        }
        throw new RuntimeException('Rejected deal discovery exceeded its page budget.');
    }
}
