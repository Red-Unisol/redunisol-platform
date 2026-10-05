<?php

namespace App\Jobs;

use App\Services\EdnaOutOfHours;
use App\Services\WhatsAppSalesContext;
use App\Support\WhatsAppOutOfHoursSettings;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class EvaluateEdnaOutOfHours implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 60;

    public function __construct(public readonly int $eventId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $event = DB::table('edna_incoming_events')->find($this->eventId);
            if (! $event || ! $event->payload || $event->status !== 'delivered' || $event->out_of_hours_evaluated_at) {
                return;
            }
            $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
            $settings = (new WhatsAppOutOfHoursSettings)->get();
            $service = new EdnaOutOfHours;
            if (! $service->eligible($event, $payload, $settings)) {
                DB::table('edna_incoming_events')->where('id', $event->id)->update(['out_of_hours_evaluated_at' => now()]);

                return;
            }
            $context = app(WhatsAppSalesContext::class)->resolve($payload['subscriber']['identifier']);
            DB::transaction(function () use ($service, $event, $payload, $context): void {
                $service->reserve($event, $payload, $context, (new WhatsAppOutOfHoursSettings)->get());
                DB::table('edna_incoming_events')->where('id', $event->id)->update(['out_of_hours_evaluated_at' => now()]);
            });
        } catch (Throwable) {
            throw new RuntimeException('Out of hours evaluation failed; inspect the event ID.');
        }
    }
}
