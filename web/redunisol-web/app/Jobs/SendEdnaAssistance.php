<?php

namespace App\Jobs;

use App\Services\EdnaApi;
use App\Services\EdnaAssistance;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

class SendEdnaAssistance implements ShouldQueue
{
    use Queueable;
    use \App\Jobs\Middleware\TracksJourney;

    public int $tries = 3;

    public int $timeout = 120;

    public function __construct(public readonly int $caseId, public readonly bool $landing = false) {}

    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $prefix = $this->landing ? 'link_' : '';
        $key = $prefix.'state';
        try {
            $case = DB::table('edna_assistance_cases')->find($this->caseId);
            if (! $case || ! in_array($case->$key, ['waiting', 'sending', 'accepted', 'unknown'], true)) {
                return;
            }
            if ($case->$key !== 'waiting') {
                Queue::connection('edna_assistance')->push(new ReconcileEdnaAssistance($case->id, $this->landing), '', 'edna-assistance');

                return;
            }
            $service = new EdnaAssistance;
            $phone = $case->recipient ? Crypt::decryptString($case->recipient) : '';
            $reason = null;
            if (! $service->modeMatches($case)) {
                $reason = 'pilot_mode_changed';
            } elseif (! config('edna.assistance_send_enabled') || ! $service->allowed($phone)
                || $case->subject_id !== (string) config('edna.subject_id')) {
                $reason = 'disabled_or_outside_pilot';
            } elseif (CarbonImmutable::parse($case->entry_received_at)->lt(now()->subHours(23))) {
                $reason = 'conversation_window_elapsed';
            } elseif (! $this->landing) {
                $reason = $service->suppression($case);
            }
            if ($reason) {
                if ($reason !== 'not_due') {
                    DB::table('edna_assistance_cases')->where('id', $case->id)->where($key, 'waiting')
                        ->update([$key => 'suppressed', 'reason' => $reason, 'updated_at' => now()]);
                }

                return;
            }
            $api = new EdnaApi;
            $api->assertCascade($case);
            if (! $this->landing && $service->hasQueuedForm($phone)) {
                DB::table('edna_assistance_cases')->where('id', $case->id)->where($key, 'waiting')
                    ->update([$key => 'suppressed', 'reason' => 'form_queued_or_submitted', 'updated_at' => now()]);

                return;
            }
            $requestId = $case->{$prefix.'request_id'};
            $content = $this->landing ? ['contentType' => 'TEXT', 'text' => Crypt::decryptString($case->link_text)]
                : ['contentType' => 'FLOW', 'flowId' => (int) EdnaAssistance::FLOW_ID,
                    'action' => 'navigate', 'caption' => 'Continuar por acá',
                    'text' => '¿Pudiste completar tu solicitud? Si te resultó complicado, te ayudamos por acá. Para pedir ayuda necesitamos tu CUIL; el email es opcional.'];
            if ($case->is_test) {
                $content['text'] = '[PRUEBA INTERNA] '.$content['text'];
            }
            $claimed = DB::transaction(function () use ($case, $key, $prefix) {
                // Serialize distinct Router cycles for the same recipient, retaining suppressed attempts.
                DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $case->scope, 'created_at' => now(), 'updated_at' => now()]);
                DB::table('edna_router_contacts')->where('scope', $case->scope)->lockForUpdate()->first();
                if (! $this->landing && DB::table('edna_assistance_cases')->where('scope', $case->scope)
                    ->where('id', '!=', $case->id)->whereNotNull('send_started_at')->exists()) {
                    DB::table('edna_assistance_cases')->where('id', $case->id)->where($key, 'waiting')
                        ->update([$key => 'suppressed', 'reason' => 'assistance_previously_started', 'updated_at' => now()]);

                    return 0;
                }

                return DB::table('edna_assistance_cases')->where('id', $case->id)->where($key, 'waiting')
                    ->update([$key => 'sending', $prefix.'send_started_at' => now(), 'updated_at' => now()]);
            });
            if (! $claimed) {
                return;
            }
            $state = 'unknown';
            try {
                $response = $api->post('cascade/schedule', ['requestId' => $requestId, 'comment' => $requestId,
                    'cascadeId' => $case->cascade_id, 'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
                    'content' => ['whatsappContent' => $content]]);
                if ($response->status() === 200 && $response->json('requestId') === $requestId) {
                    $state = 'accepted';
                } elseif ($response->clientError() && ! in_array($response->status(), [408, 429], true)) {
                    $state = 'rejected';
                }
            } catch (Throwable) {
                // A lost acknowledgement may already have sent the message. Never repeat the POST.
            }
            DB::table('edna_assistance_cases')->where('id', $case->id)->where($key, 'sending')
                ->update([$key => $state, 'updated_at' => now()]);
            if ($state !== 'rejected') {
                Queue::connection('edna_assistance')->later(5, new ReconcileEdnaAssistance($case->id, $this->landing), '', 'edna-assistance');
            }
        } catch (Throwable) {
            throw new RuntimeException('Assistance send failed; inspect the case ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        $key = $this->landing ? 'link_state' : 'state';
        DB::table('edna_assistance_cases')->where('id', $this->caseId)->where($key, 'waiting')
            ->update([$key => 'review', 'reason' => 'preflight_failed', 'updated_at' => now()]);
        DB::table('edna_assistance_cases')->where('id', $this->caseId)->where($key, 'sending')
            ->update([$key => 'unknown', 'reason' => 'send_unconfirmed', 'updated_at' => now()]);
    }
}
