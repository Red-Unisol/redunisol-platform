<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Discover positive work without walking the stock of forms with no customer message. */
class CommercialChatCandidates
{
    public function __construct(private CommercialChatReadiness $readiness) {}

    public function page(string $channel, int $after): array
    {
        $cut = DB::table('edna_intake_cutovers')->where('name', EdnaFreshIntake::OWNERSHIP)->first();
        if (! $cut) {
            return ['ids' => [], 'next' => null];
        }
        if ($channel === 'outbound') {
            $rows = collect($this->readiness->outboundPage($after, ['>=CREATED' => CarbonImmutable::parse($cut->starts_at)->toIso8601String()]));
            $ids = $rows->pluck('OWNER_ID');
            $last = $rows->last()['ID'] ?? null;
        } elseif ($channel === 'web') {
            $rows = DB::table('web_form_chat_routes as w')->join('web_form_receipts as f', 'f.id', '=', 'w.submission_id')
                ->where('f.received_at', '>=', $cut->starts_at)->where('w.entry_event_id', '>', max($after, (int) $cut->entry_id_after))
                ->whereIn('w.state', ['pending', 'processing', 'waiting'])->where('w.transfer_state', 'pending')
                ->where('w.updated_at', '>=', now()->subDay())->whereNotNull('w.deal_id')->whereNotNull('w.proof->commercial_readiness')
                ->orderBy('w.entry_event_id')->limit(50)->get(['w.entry_event_id', 'w.deal_id']);
            $ids = $rows->pluck('deal_id');
            $last = $rows->last()->entry_event_id ?? null;
        } else {
            $rows = DB::table('edna_intake_chat_routes as r')->join('edna_intake_requests as i', 'i.id', '=', 'r.request_id')
                ->join('edna_flow_sends as s', 's.id', '=', 'i.flow_send_id')
                ->where('s.entry_event_id', '>', $cut->entry_id_after)->where('s.entry_received_at', '>=', $cut->starts_at)
                ->where('r.request_id', '>', $after)->where('r.state', 'pending')->whereNull('r.transfer_intent')
                ->where('r.updated_at', '>=', now()->subDay())->whereNotNull('i.lead_id')
                ->orderBy('r.request_id')->limit(50)->get(['r.request_id', 'i.lead_id']);
            $ids = $rows->pluck('lead_id');
            $last = $rows->last()->request_id ?? null;
        }
        if ($rows->count() > 50 || ($rows->isNotEmpty() && (int) $last <= $after)) {
            throw new \RuntimeException('Incomplete commercial candidate page.');
        }

        return ['ids' => $ids->map(fn ($id) => (int) $id)->filter(fn ($id) => $id > 0)->unique()->values()->all(),
            'next' => $rows->count() === 50 ? (int) $last : null];
    }
}
