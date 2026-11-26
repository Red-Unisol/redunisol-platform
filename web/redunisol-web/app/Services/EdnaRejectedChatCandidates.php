<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use JsonException;

/** Local discovery only: CRM rejection and notice evidence are checked by the closer. */
class EdnaRejectedChatCandidates
{
    public function discover(int $limit = 200): array
    {
        if ($limit < 1 || ! $this->id(config('edna.subject_id'))) {
            return [];
        }
        $limit = min($limit, 1000);
        $until = CarbonImmutable::now();
        $since = $until->subDay();
        $subject = (string) config('edna.subject_id');
        $candidates = [];

        $bindings = DB::table('edna_intake_bindings as b')
            ->join('edna_flow_sends as f', 'f.id', '=', 'b.flow_send_id')
            ->join('edna_incoming_events as e', 'e.id', '=', 'b.entry_event_id')
            ->where('b.state', 'verified')->where('f.subject_id', $subject)->where('e.subject_id', $subject)
            ->whereColumn('b.case_id', 'f.request_id')->whereColumn('b.entry_event_id', 'f.entry_event_id')
            ->whereBetween('b.created_at', [$since, $until])->whereBetween('e.created_at', [$since, $until]);

        foreach ((clone $bindings)->orderByDesc('b.created_at')->orderByDesc('b.id')->limit($limit)
            ->get(['b.id', 'b.proof', 'b.lead_id', 'b.entry_event_id', 'e.message_id as external_id', 'b.created_at as source_created_at']) as $row) {
            $proof = $this->proof($row);
            $lead = $proof['native_lead_id'] ?? $proof['lead_id'] ?? null;
            if ($proof && $this->id($lead) && (! $row->lead_id || (string) $row->lead_id === (string) $lead)) {
                $this->add($candidates, $row, $proof, $lead, 'edna_intake_binding');
            }
        }

        foreach ((clone $bindings)->join('edna_intake_requests as r', 'r.flow_send_id', '=', 'b.flow_send_id')
            ->where('r.state', 'synced')->whereBetween('r.created_at', [$since, $until])
            ->orderByDesc('r.created_at')->orderByDesc('r.id')->limit($limit)
            ->get(['r.id', 'r.lead_id', 'b.proof', 'b.entry_event_id', 'e.message_id as external_id', 'r.created_at as source_created_at']) as $row) {
            $proof = $this->proof($row);
            // CONTACT-native v2 proofs intentionally do not invent a native lead.
            if ($proof && $this->id($row->lead_id)
                && (! isset($proof['lead_id']) || (string) $proof['lead_id'] === (string) $row->lead_id)) {
                $this->add($candidates, $row, $proof, $row->lead_id, 'edna_intake_request');
            }
        }

        foreach (DB::table('edna_organic_menus as m')
            ->join('edna_incoming_events as e', 'e.id', '=', 'm.entry_event_id')
            ->where('m.state', 'loan_submitted')->where('m.subject_id', $subject)->where('e.subject_id', $subject)
            ->whereBetween('m.created_at', [$since, $until])->whereBetween('e.created_at', [$since, $until])
            ->orderByDesc('m.created_at')->orderByDesc('m.id')->limit($limit)
            ->get(['m.id', 'm.proof', 'm.profile_evidence', 'm.chat_id', 'm.session_id', 'm.entry_event_id',
                'e.message_id as external_id', 'm.created_at as source_created_at']) as $row) {
            $proof = $this->proof($row);
            $result = $this->decode($row->profile_evidence)['result'] ?? null;
            if ($proof && is_array($result) && $this->id($result['lead_id'] ?? null)
                && in_array($result['action'] ?? '', ['queued', 'already_processed', 'rejected'], true)
                && (string) $row->chat_id === (string) $proof['chat_id']
                && (string) $row->session_id === (string) $proof['session_id']) {
                $this->add($candidates, $row, $proof, $result['lead_id'], 'edna_organic_menu');
            }
        }

        foreach (DB::table('web_form_chat_routes as w')
            ->join('web_form_receipts as r', 'r.id', '=', 'w.submission_id')
            ->join('edna_incoming_events as e', 'e.id', '=', 'w.entry_event_id')
            ->where('r.state', 'synced')->where('e.subject_id', $subject)
            ->whereBetween('w.created_at', [$since, $until])->whereBetween('r.created_at', [$since, $until])
            ->whereBetween('e.created_at', [$since, $until])
            ->orderByDesc('w.created_at')->orderByDesc('w.entry_event_id')->limit($limit)
            ->get(['w.entry_event_id as id', 'w.entry_event_id', 'w.proof', 'r.lead_id', 'r.received_at as form_received_at',
                'e.message_id as external_id', 'w.created_at as source_created_at']) as $row) {
            if (($proof = $this->proof($row)) && $this->id($row->lead_id)) {
                $this->add($candidates, $row, $proof, $row->lead_id, 'web_form_chat_route');
            }
        }

        usort($candidates, fn ($a, $b) => strcmp($b['source_created_at'], $a['source_created_at']));
        $unique = [];
        foreach ($candidates as $candidate) {
            $key = $candidate['proof']['chat_id'].':'.$candidate['proof']['session_id'].':'.$candidate['lead_id'];
            $unique[$key] ??= $candidate;
        }

        return array_slice(array_values($unique), 0, $limit);
    }

    private function proof(object $row): ?array
    {
        $proof = $this->decode($row->proof);
        if (($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id'
            || (array_key_exists('version', $proof) && ! in_array($proof['version'], [1, 2], true))
            || (string) ($proof['entry_event_id'] ?? '') !== (string) $row->entry_event_id
            || (string) ($proof['entry_message_id'] ?? '') !== (string) $row->external_id) {
            return null;
        }
        foreach (['entry_event_id', 'entry_message_id', 'chat_id', 'session_id', 'message_id'] as $key) {
            if (! $this->id($proof[$key] ?? null)) {
                return null;
            }
        }
        if (isset($proof['activity_id']) && ! $this->id($proof['activity_id'])) {
            return null;
        }

        return $proof;
    }

    private function add(array &$candidates, object $row, array $proof, mixed $lead, string $type): void
    {
        $candidates[] = ['lead_id' => (string) $lead, 'proof' => $proof, 'source_type' => $type,
            'source_id' => (string) $row->id, 'source_created_at' => CarbonImmutable::parse($row->source_created_at)->toIso8601String(),
            'form_received_at' => isset($row->form_received_at) ? CarbonImmutable::parse($row->form_received_at)->toIso8601String() : null];
    }

    private function decode(mixed $value): array
    {
        try {
            $value = is_string($value) ? json_decode($value, true, 32, JSON_THROW_ON_ERROR) : $value;
        } catch (JsonException) {
            return [];
        }

        return is_array($value) ? $value : [];
    }

    private function id(mixed $value): bool
    {
        return (is_string($value) || is_int($value)) && preg_match('/^[1-9][0-9]{0,18}$/D', (string) $value) === 1;
    }
}
