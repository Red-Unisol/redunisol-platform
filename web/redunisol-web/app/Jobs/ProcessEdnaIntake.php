<?php

namespace App\Jobs;

use App\Services\EdnaIntake;
use App\Services\JourneyLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class ProcessEdnaIntake implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 105; // Below the edna connection's 120-second visibility timeout.

    public function __construct(public readonly int $requestId) {}

    public function handle(): void
    {
        $request = DB::table('edna_intake_requests')->find($this->requestId);
        if (! $request || $request->state !== 'pending') {
            return;
        }
        $service = new EdnaIntake;
        $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
        $url = (string) config('edna.intake_processing_url');
        if (! $send || ! $service->canSend($send) || ! config('edna.intake_crm_enabled')
            || parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)
            || ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_intake/')) {
            $this->record(['state' => 'review', 'reason' => 'intake_disabled_or_unconfigured']);

            return;
        }
        if (! DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')
            ->update(['state' => 'processing', 'updated_at' => now()])) {
            return;
        }
        try {
            $response = Http::asJson()->acceptJson()->connectTimeout(5)->timeout(85)->withoutRedirecting()->post($url, [
                'contract' => ($send->intake_test ?? false) ? EdnaIntake::TEST_CONTRACT : EdnaIntake::CONTRACT,
                'case_id' => $send->request_id, 'flow_id' => $send->flow_id,
                'acknowledgement_version' => 2,
                'phone' => Crypt::decryptString($send->recipient), 'dry_run' => false,
                'test_reference' => ($send->intake_test ?? false) ? EdnaIntake::TEST_REFERENCE : null,
                'answer' => json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR),
                'received_at' => CarbonImmutable::parse($request->received_at)->toIso8601String(),
                'attribution' => $service->attribution($send),
            ]);
            $result = $response->json();
            $action = $result['action'] ?? '';
            if ($response->successful() && ($result['ok'] ?? false) === false && $action === 'invalid') {
                $this->record(['state' => 'review', 'reason' => 'invalid_intake_response']);

                return;
            }
            if (! $response->successful() || ($result['ok'] ?? null) !== true || ($result['case_id'] ?? '') !== $send->request_id
                || ! in_array($action, ['queued', 'manual_review', 'already_processed', 'rejected', 'disabled', 'review'], true)
                || ($action === 'rejected' && ! preg_match('/^[1-9][0-9]*$/D', (string) ($result['lead_id'] ?? '')))) {
                throw new RuntimeException('Invalid intake acknowledgement.');
            }
            $this->record(['state' => in_array($action, ['queued', 'already_processed', 'rejected'], true) ? 'synced' : 'review',
                'lead_id' => $result['lead_id'] ?? null, 'contact_id' => $result['contact_id'] ?? null,
                'reason' => $result['reason'] ?? $action]);
            try {
                app(JourneyLedger::class)->record('whatsapp.intake_processed', ['action' => $action], [
                    'journey_id' => $send->journey_id, 'request_id' => $send->request_id,
                    'flow_send_id' => (string) $send->id, 'lead_id' => $result['lead_id'] ?? null,
                    'contact_id' => $result['contact_id'] ?? null,
                ], 'whatsapp.edna');
                app(JourneyLedger::class)->flush();
            } catch (Throwable) {
                // Tracking availability must not change an acknowledged CRM outcome.
            }
        } catch (Throwable) {
            $this->record(['state' => 'unknown', 'reason' => 'crm_acknowledgement_uncertain']);
        }
    }

    private function record(array $fields): void
    {
        DB::table('edna_intake_requests')->where('id', $this->requestId)->update($fields + ['updated_at' => now()]);
    }

    public function failed(?Throwable $exception): void
    {
        $this->record(['state' => 'unknown', 'reason' => 'worker_interrupted']);
    }
}
