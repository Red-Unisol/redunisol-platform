<?php

namespace App\Console\Commands;

use App\Jobs\ReconcileEdnaLanding;
use App\Jobs\SyncEdnaRouterCrm;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaRouterResult;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Throwable;

class EdnaResults extends Command
{
    protected $signature = 'edna:results {action=status : status, reconcile, crm or prepare} {id? : Result ID; Flow send ID for prepare}';

    protected $description = 'Inspect landing/CRM results and recover without resending WhatsApp messages';

    public function handle(): int
    {
        $action = $this->argument('action');
        $id = $this->argument('id');
        if (! in_array($action, ['status', 'reconcile', 'crm', 'prepare'], true) || ($id !== null && ! ctype_digit((string) $id))) {
            return self::FAILURE;
        }
        if ($action === 'prepare') {
            return $id === null ? self::FAILURE : $this->prepare((int) $id);
        }
        if ($action === 'status') {
            $this->line(json_encode(DB::table('edna_router_results')->when($id !== null, fn ($q) => $q->where('id', $id))
                ->latest('id')->limit(50)->get(['id', 'flow_send_id', 'response_event_id', 'province', 'segment', 'landing_url',
                    'state', 'reason', 'outgoing_message_id', 'crm_state', 'crm_reason', 'crm_entity', 'crm_id', 'crm_synced_at'])));

            return self::SUCCESS;
        }
        $result = $id === null ? null : DB::table('edna_router_results')->find((int) $id);
        if (! $result || ($action === 'reconcile' && ! in_array($result->state, ['sending', 'accepted', 'unknown'], true))) {
            return self::FAILURE;
        }
        Queue::connection('edna')->push($action === 'crm' ? new SyncEdnaRouterCrm($result->id) : new ReconcileEdnaLanding($result->id), '', 'edna');
        $this->info('Recovery queued; no WhatsApp message will be resent.');

        return self::SUCCESS;
    }

    private function prepare(int $flowId): int
    {
        try {
            DB::transaction(function () use ($flowId): void {
                $initial = DB::table('edna_flow_sends')->find($flowId);
                if (! $initial || ! $initial->response_event_id || ! config('edna.router_recipients', [])) {
                    throw new \RuntimeException('A completed pilot Flow is required.');
                }
                // Same lock order as incoming processing: event, then Flow ledger.
                $event = DB::table('edna_incoming_events')->where('id', $initial->response_event_id)->lockForUpdate()->first();
                $send = DB::table('edna_flow_sends')->where('id', $flowId)->lockForUpdate()->first();
                if (! $event || $event->status !== 'delivered' || $event->router_action !== 'verified_response'
                    || (int) $event->flow_send_id !== $flowId || ! $event->payload
                    || ! (new EdnaRouterResult)->eligible($send)) {
                    throw new \RuntimeException('Verified pilot response is required.');
                }
                $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
                $received = CarbonImmutable::parse($payload['receivedAt']);
                if ($received->lt(now()->subHours(23)) || $received->gt(now()->addMinutes(5))) {
                    throw new \RuntimeException('Response is outside the send window.');
                }
                $context = (new EdnaFlowRouter)->correlate($event, $payload);
                if (! $context) {
                    throw new \RuntimeException('Pilot correlation could not be verified.');
                }
                (new EdnaRouterResult)->reserve($event, $context, $payload);
            });
            $this->info('Verified pilot response prepared; existing results are not duplicated.');

            return self::SUCCESS;
        } catch (Throwable) {
            $this->error('Only a recent verified response from an enabled pilot recipient can be prepared.');

            return self::FAILURE;
        }
    }
}
