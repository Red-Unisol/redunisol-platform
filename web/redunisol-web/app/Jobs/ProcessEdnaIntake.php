<?php

namespace App\Jobs;

use App\Services\EdnaIntake;
use App\Services\EdnaIntakeBinding;
use App\Services\JourneyLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
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
        if ($send) {
            $send = $service->promoteUnprocessedCurrentFlow($send);
            if ($service->requiresChannelContract($send) && ! $service->isChannelContract($send)) {
                $this->record(['state' => 'review', 'reason' => 'crm_binding_unavailable']);

                return;
            }
        }
        $url = (string) config('edna.intake_processing_url');
        if (! $send || ! $service->canSend($send) || ! config('edna.intake_crm_enabled')
            || parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)
            || ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_intake/')) {
            $this->record(['state' => 'review', 'reason' => 'intake_disabled_or_unconfigured']);

            return;
        }
        $binding = null;
        $entryContext = null;
        if ($service->isChannelContract($send)) {
            $entryContext = $service->entryContext($send);
            try {
                // Only the separate binding job may read Bitrix. Keeping this
                // lookup local preserves the CRM acknowledgement time budget.
                $binding = app(EdnaIntakeBinding::class)->verified($send);
            } catch (Throwable) {
                $binding = null;
            }
            if (! $binding) {
                $this->awaitBinding();

                return;
            }
            if (! $entryContext || ! is_array($binding) || ($binding['version'] ?? null) !== 1
                || ($binding['source'] ?? '') !== 'bitrix_openline_session' || ($binding['verified'] ?? null) !== true
                || ! preg_match('/^[1-9][0-9]{0,63}$/D', (string) ($binding['lead_id'] ?? ''))
                || ($binding['entry_event_id'] ?? null) !== $entryContext['event_id']
                || ($binding['entry_message_id'] ?? null) !== $entryContext['message_id']) {
                $this->record(['state' => 'review', 'reason' => 'crm_binding_invalid']);

                return;
            }
        }
        if (! DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')
            ->update(['state' => 'processing', 'updated_at' => now()])) {
            return;
        }
        try {
            $body = [
                'contract' => $service->contractFor($send),
                'case_id' => $send->request_id, 'flow_id' => $send->flow_id,
                'acknowledgement_version' => 2,
                'phone' => Crypt::decryptString($send->recipient), 'dry_run' => false,
                'test_reference' => ($send->intake_test ?? false) ? EdnaIntake::TEST_REFERENCE : null,
                'answer' => json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR),
                'received_at' => CarbonImmutable::parse($request->received_at)->toIso8601String(),
                'attribution' => $service->attribution($send),
            ];
            if ($binding) {
                $body['entry_context'] = $entryContext;
                $body['crm_binding'] = $binding;
            }
            $response = Http::asJson()->acceptJson()->connectTimeout(5)->timeout(85)->withoutRedirecting()->post($url, $body);
            $result = $response->json();
            $action = $result['action'] ?? '';
            if ($response->successful() && ($result['ok'] ?? false) === false && $action === 'invalid') {
                $this->record(['state' => 'review', 'reason' => 'invalid_intake_response']);

                return;
            }
            if (! $response->successful() || ($result['ok'] ?? null) !== true || ($result['case_id'] ?? '') !== $send->request_id
                || ! in_array($action, ['queued', 'manual_review', 'already_processed', 'rejected', 'disabled', 'review'], true)
                || ($action === 'rejected' && ! preg_match('/^[1-9][0-9]*$/D', (string) ($result['lead_id'] ?? '')))
                || ($binding && $action !== 'disabled' && (string) ($result['lead_id'] ?? '') !== $binding['lead_id'])) {
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

    private function awaitBinding(): void
    {
        DB::transaction(function (): void {
            $request = DB::table('edna_intake_requests')->where('id', $this->requestId)->lockForUpdate()->first();
            if (! $request || $request->state !== 'pending') {
                return;
            }
            DB::table('edna_intake_requests')->where('id', $request->id)->update([
                'state' => 'awaiting_binding', 'reason' => 'crm_binding_pending', 'updated_at' => now(),
            ]);
            Queue::connection('edna')->push(new ResolveEdnaIntakeBinding($request->id), '', 'edna');
        });
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
