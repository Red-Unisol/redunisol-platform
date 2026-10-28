<?php

namespace App\Jobs;

use App\Services\EdnaOutOfHours;
use App\Services\WhatsAppSalesContext;
use App\Support\WhatsAppOutOfHoursSettings;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class EvaluateEdnaOutOfHours implements ShouldQueue
{
    use Queueable;
    use \App\Jobs\Middleware\TracksJourney;

    public int $tries = 8;

    public int $timeout = 90;

    // A default also lets jobs queued before this field existed adopt an owner.
    public ?string $evaluationId = null;

    public function __construct(public readonly int $eventId, ?string $evaluationId = null)
    {
        $this->evaluationId = $evaluationId;
    }

    public static function enqueue(int $eventId, int $delay = 0, bool $retryFailed = false): bool
    {
        return DB::transaction(function () use ($eventId, $delay, $retryFailed): bool {
            $event = DB::table('edna_incoming_events')->where('id', $eventId)->lockForUpdate()->first();
            if (! $event || ! $event->payload || $event->status !== 'delivered' || ! $event->out_of_hours_candidate
                || $event->out_of_hours_evaluated_at
                || ($event->out_of_hours_evaluation_id && (! $retryFailed || ! $event->out_of_hours_evaluation_failed_at))) {
                return false;
            }
            $id = (string) Str::uuid();
            DB::table('edna_incoming_events')->where('id', $eventId)->update([
                'out_of_hours_evaluation_id' => $id, 'out_of_hours_evaluation_failed_at' => null,
            ]);
            // The ownership marker and durable job commit or roll back together.
            Queue::connection('edna')->later($delay, new self($eventId, $id), '', 'edna');

            return true;
        });
    }

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $event = $this->claim();
            if (! $event) {
                return;
            }
            $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
            $settings = (new WhatsAppOutOfHoursSettings)->get();
            $service = new EdnaOutOfHours;
            $window = $service->eligible($event, $payload, $settings);
            if ($window) {
                $context = app(WhatsAppSalesContext::class)->resolve($payload['subscriber']['identifier'], $window['requirements']);
                $service->reserve($event, $payload, $context, (new WhatsAppOutOfHoursSettings)->get());
            }
            DB::table('edna_incoming_events')->where('id', $event->id)
                ->where('out_of_hours_evaluation_id', $this->evaluationId)->update(['out_of_hours_evaluated_at' => now()]);
        } catch (Throwable) {
            throw new RuntimeException('Out of hours evaluation failed; inspect the event ID.');
        }
    }

    private function claim(): ?object
    {
        // The queue UUID survives release/backoff, including for pre-deploy jobs.
        $this->evaluationId ??= $this->job?->uuid() ?? (string) Str::uuid();

        return DB::transaction(function (): ?object {
            $event = DB::table('edna_incoming_events')->where('id', $this->eventId)->lockForUpdate()->first();
            if (! $event || ! $event->payload || $event->status !== 'delivered' || ! $event->out_of_hours_candidate
                || $event->out_of_hours_evaluated_at
                || ($event->out_of_hours_evaluation_id && $event->out_of_hours_evaluation_id !== $this->evaluationId)) {
                return null;
            }
            DB::table('edna_incoming_events')->where('id', $event->id)->update([
                'out_of_hours_evaluation_id' => $this->evaluationId, 'out_of_hours_evaluation_failed_at' => null,
            ]);

            return $event;
        });
    }

    public function failed(?Throwable $exception): void
    {
        $id = $this->evaluationId ?? $this->job?->uuid();
        if ($id) {
            DB::table('edna_incoming_events')->where('id', $this->eventId)
                ->where('out_of_hours_evaluation_id', $id)->whereNull('out_of_hours_evaluated_at')
                ->update(['out_of_hours_evaluation_failed_at' => now()]);
        }
    }
}
