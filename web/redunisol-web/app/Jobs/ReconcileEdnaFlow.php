<?php

namespace App\Jobs;

use App\Services\EdnaFlowDelivery;
use App\Services\EdnaFlowTransport;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ReconcileEdnaFlow implements ShouldQueue
{
    use Queueable;
    use \App\Jobs\Middleware\TracksJourney;

    public int $tries = 8;

    public int $timeout = 40;

    // Missing aliases in older serialized jobs belong to the original attempt.
    public ?string $transportRequestId = null;

    public function __construct(public readonly int $sendId, ?string $transportRequestId = null)
    {
        $this->transportRequestId = $transportRequestId;
    }

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
            $transport = app(EdnaFlowTransport::class);
            if (! $send || ! $transport->matches($send, $this->transportRequestId)
                || ! in_array($send->state, ['sending', 'accepted', 'unknown'], true)) {
                return;
            }
            $evidence = app(EdnaFlowDelivery::class)->evidence($send);
            $transport->update($send, ['sending', 'accepted', 'unknown'], [
                'state' => $evidence['state'], 'reason' => $evidence['reason'],
                'outgoing_message_id' => $evidence['outgoing_message_id'], 'updated_at' => now(),
            ]);
        } catch (Throwable) {
            throw new RuntimeException('Edna Flow history unconfirmed; inspect the send ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
        $transport = app(EdnaFlowTransport::class);
        if (! $send || ! $transport->matches($send, $this->transportRequestId)) {
            return;
        }
        $transport->update($send, ['sending', 'accepted', 'unknown'], [
            'state' => 'unknown', 'reason' => 'history_exhausted', 'updated_at' => now(),
        ]);
    }
}
