<?php

namespace App\Jobs;

use App\Services\EdnaIntake;
use App\Services\EdnaIntakeBinding;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Throwable;

class ResolveEdnaIntakeBinding implements ShouldQueue
{
    use Queueable;

    public int $tries = 6;

    public int $timeout = 60; // Leaves room for the final bounded provider read in flight.

    public function __construct(public readonly int $requestId, public readonly ?int $flowSendId = null) {}

    public function backoff(): array
    {
        return [5, 15, 30, 60, 120];
    }

    public function handle(): void
    {
        $request = $this->requestId ? DB::table('edna_intake_requests')->find($this->requestId) : null;
        if ($this->requestId && (! $request || $request->state !== 'awaiting_binding')) {
            return;
        }
        $send = DB::table('edna_flow_sends')->find($request?->flow_send_id ?? $this->flowSendId);
        $intake = new EdnaIntake;
        if (! $send || ! $intake->isChannelContract($send)
            || ($request && ($send->state !== 'completed' || (int) $send->response_event_id !== (int) $request->response_event_id))
            || ! config('edna.intake_crm_enabled') || ! $intake->canSend($send)) {
            $this->unavailable('intake_disabled_or_unconfigured');

            return;
        }
        try {
            // Resolve without holding an inbox/request lock during provider reads.
            $binding = app(EdnaIntakeBinding::class)->resolve($send);
        } catch (Throwable) {
            $binding = null;
        }
        if (! $binding) {
            if ($this->attempts() >= $this->tries) {
                $this->unavailable('crm_binding_unavailable');
            } else {
                $delays = $this->backoff();
                $this->release($delays[max(0, min($this->attempts() - 1, count($delays) - 1))]);
            }

            return;
        }
        if (! $request) {
            return;
        }
        DB::transaction(function () use ($request): void {
            $current = DB::table('edna_intake_requests')->where('id', $request->id)->lockForUpdate()->first();
            if (! $current || $current->state !== 'awaiting_binding') {
                return;
            }
            DB::table('edna_intake_requests')->where('id', $current->id)->update([
                'state' => 'pending', 'reason' => 'crm_binding_verified', 'updated_at' => now(),
            ]);
            Queue::connection('edna')->push(new ProcessEdnaIntake($current->id), '', 'edna');
        });
    }

    private function unavailable(string $reason): void
    {
        DB::table('edna_intake_requests')->where('id', $this->requestId)->where('state', 'awaiting_binding')->update([
            'state' => 'review', 'reason' => $reason, 'updated_at' => now(),
        ]);
    }

    public function failed(?Throwable $exception): void
    {
        $this->unavailable('crm_binding_unavailable');
    }
}
