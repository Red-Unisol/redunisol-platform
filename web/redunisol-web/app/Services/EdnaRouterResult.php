<?php

namespace App\Services;

use App\Jobs\SendEdnaLanding;
use App\Jobs\SyncEdnaRouterCrm;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

class EdnaRouterResult
{
    // Called only inside the verified-response transaction; never backfill old responses.
    public function reserve(object $event, array $context, array $payload): void
    {
        if (! config('edna.results_enabled')) {
            return;
        }
        $send = DB::table('edna_flow_sends')->find($context['send_id']);
        if (! $send || ! $this->eligible($send)) {
            return;
        }
        $route = (new EdnaLandingRoute)->resolve($payload);
        if (DB::table('edna_router_results')->where('flow_send_id', $send->id)->exists()) {
            return;
        }
        $id = DB::table('edna_router_results')->insertGetId($route + [
            'flow_send_id' => $send->id, 'response_event_id' => $event->id,
            'response_received_at' => CarbonImmutable::parse($payload['receivedAt'])->utc(),
            'request_id' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        Queue::connection('edna')->push(new SendEdnaLanding($id), '', 'edna');
        Queue::connection('edna')->push(new SyncEdnaRouterCrm($id), '', 'edna');
    }

    public function eligible(object $send): bool
    {
        if (! config('edna.enabled') || ! config('edna.router_enabled') || ! config('edna.results_enabled')
            || $send->subject_id !== (string) config('edna.subject_id') || ! $send->recipient
            || $send->flow_id !== EdnaFlowRouter::FLOW_ID || $send->state !== 'completed') {
            return false;
        }
        $allowed = config('edna.router_recipients', []);

        return ! $allowed || in_array(Crypt::decryptString($send->recipient), $allowed, true);
    }
}
