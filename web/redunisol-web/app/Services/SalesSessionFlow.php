<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use RuntimeException;

/** Local evidence that a real v3, including its CRM submission, already owns the native session. */
class SalesSessionFlow
{
    public function find(int $chatId, int $sessionId): ?object
    {
        $flows = DB::table('edna_flow_sends as s')->join('edna_intake_bindings as b', 'b.flow_send_id', '=', 's.id')
            ->where('b.native_session_id', $sessionId)->where('b.state', 'verified')
            ->where('s.subject_id', (string) config('edna.subject_id'))->where('s.cascade_id', (string) config('edna.cascade_id'))
            ->where('s.flow_id', (string) config('edna.intake_flow_id'))->where('s.intake_test', false)
            ->whereIn('s.state', ['pending', 'sending', 'unknown', 'accepted', 'confirmed', 'completed'])->limit(2)->get(['s.*']);
        if ($flows->count() > 1) {
            throw new RuntimeException('Multiple current v3 bindings in session.');
        }
        $flow = $flows->first();
        if (! $flow) {
            return null;
        }
        $proof = app(EdnaIntakeBinding::class)->verified($flow);
        if (! $proof || (int) ($proof['session_id'] ?? 0) !== $sessionId || (int) ($proof['chat_id'] ?? 0) !== $chatId) {
            throw new RuntimeException('Ambiguous v3 session binding.');
        }

        return $flow;
    }

    /** A pending or unanswered recent v3 for the same recipient postpones any second greeting. */
    public function hasRecentActive(string $subject, string $phoneHash): bool
    {
        return DB::table('edna_flow_sends as s')->join('edna_intake_admissions as a', 'a.id', '=', 's.intake_admission_id')
            ->where('a.recipient_hash', $phoneHash)->whereNull('s.response_event_id')->whereNull('s.completed_at')
            ->where('s.subject_id', $subject)->where('s.cascade_id', (string) config('edna.cascade_id'))
            ->where('s.flow_id', (string) config('edna.intake_flow_id'))->where('s.intake_test', false)
            ->whereBetween('s.entry_received_at', [now()->subHours(23), now()->addMinutes(5)])
            ->whereIn('s.state', ['pending', 'sending', 'unknown', 'accepted', 'confirmed'])->exists();
    }

    public function disposition(object $flow): array
    {
        if (! $flow->response_event_id && ! $flow->completed_at && $flow->state !== 'completed') {
            return ['state' => 'waiting', 'reason' => 'v3_delivery_or_response_not_verified'];
        }
        $request = DB::table('edna_intake_requests')->where('flow_send_id', $flow->id)
            ->where('response_event_id', $flow->response_event_id)->first();
        if (! $request) {
            return ['state' => 'waiting', 'reason' => 'v3_answer_intake_not_recorded'];
        }

        return match ($request->state) {
            'pending', 'processing', 'awaiting_binding' => ['state' => 'waiting', 'reason' => 'v3_answer_processing'],
            'synced' => ['state' => 'waiting', 'reason' => 'v3_synced_awaiting_chat_disposition'],
            default => ['state' => 'needs_attention', 'reason' => 'v3_answer_requires_reconciliation'],
        };
    }
}
