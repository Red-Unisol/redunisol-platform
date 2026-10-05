<?php

namespace App\Console\Commands;

use App\Jobs\EvaluateEdnaOutOfHours;
use App\Jobs\ReconcileEdnaOutOfHours;
use App\Jobs\SendEdnaOutOfHours;
use App\Models\EdnaOutOfHoursSend;
use App\Support\WhatsAppOutOfHoursSettings;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

class EdnaOutOfHoursCommand extends Command
{
    protected $signature = 'edna:out-of-hours {operation : report, recover or prune} {--apply : Apply recovery or retention}';

    protected $description = 'Inspect and recover Sales notices without logging recipient data';

    public function handle(): int
    {
        $operation = $this->argument('operation');
        if ($operation === 'report') {
            $rows = EdnaOutOfHoursSend::query()->selectRaw('notice_type, state, count(*) as total')->groupBy('notice_type', 'state')->get();
            $this->table(['Type', 'State', 'Count'], $rows->map(fn ($r) => [$r->notice_type, $r->state, $r->total]));
            $settings = (new WhatsAppOutOfHoursSettings)->get();
            $groups = [];
            foreach (DB::table('edna_flow_sends')->where('entry_received_at', '>=', now()->subDays(30))
                ->cursor(['entry_received_at', 'state']) as $flow) {
                $received = CarbonImmutable::parse($flow->entry_received_at, 'UTC');
                $local = $received->setTimezone($settings['timezone']);
                $phase = $settings['enabled_since'] && $received->gte(CarbonImmutable::parse($settings['enabled_since'])) ? 'after' : 'before';
                $band = $local->isWeekend() ? 'weekend' : ((new WhatsAppOutOfHoursSettings)->window($received, $settings) ? 'out_of_hours' : 'business_hours');
                $key = $phase.':'.$band;
                $groups[$key] ??= [0, 0];
                $groups[$key][0]++;
                $groups[$key][1] += $flow->state === 'completed' ? 1 : 0;
            }
            $this->table(['Phase / band (last 30 days)', 'Router sends', 'Completed', 'Completion %'],
                collect($groups)->map(fn ($n, $key) => [$key, $n[0], $n[1], round(100 * $n[1] / $n[0], 1)]));

            return self::SUCCESS;
        }
        if ($operation === 'prune') {
            $query = EdnaOutOfHoursSend::whereIn('state', ['confirmed', 'rejected', 'cancelled', 'expired'])
                ->where('created_at', '<', now()->subDays(30))->whereNotNull('recipient');
            $this->info('Closed notices eligible for clearing: '.$query->count());
            if ($this->option('apply')) {
                $query->update(['recipient' => null, 'message_text' => null, 'updated_at' => now()]);
            }

            return self::SUCCESS;
        }
        if ($operation !== 'recover') {
            $this->error('Use report, recover or prune.');

            return self::FAILURE;
        }
        $events = DB::table('edna_incoming_events')->where('status', 'delivered')->where('out_of_hours_candidate', true)
            ->whereNull('out_of_hours_evaluated_at')->where('delivered_at', '>', now()->subHours(23))
            ->where('updated_at', '<', now()->subMinutes(5));
        $this->info('Events eligible for evaluation recovery: '.$events->count());
        if ($this->option('apply')) {
            $events->orderBy('id')->limit(100)->get(['id'])->each(function ($event): void {
                DB::transaction(function () use ($event): void {
                    Queue::connection('edna')->push(new EvaluateEdnaOutOfHours($event->id), '', 'edna');
                    DB::table('edna_incoming_events')->where('id', $event->id)->update(['updated_at' => now()]);
                });
            });
        }
        $query = EdnaOutOfHoursSend::whereIn('state', ['pending', 'sending', 'accepted', 'unknown'])->where('updated_at', '<', now()->subMinutes(5));
        $this->info('Notices eligible for recovery: '.$query->count());
        if ($this->option('apply')) {
            $query->chunkById(100, function ($rows): void {
                foreach ($rows as $send) {
                    DB::transaction(function () use ($send): void {
                        Queue::connection('edna')->push($send->state === 'pending'
                            ? new SendEdnaOutOfHours($send->id) : new ReconcileEdnaOutOfHours($send->id), '', 'edna');
                        EdnaOutOfHoursSend::whereKey($send->id)->update(['updated_at' => now()]);
                    });
                }
            });
        }

        return self::SUCCESS;
    }
}
