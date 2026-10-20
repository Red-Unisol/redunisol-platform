<?php

namespace App\Jobs;

use App\Services\EdnaAssistance;
use App\Services\WhatsAppSalesContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Throwable;

class ProcessEdnaAssistance implements ShouldQueue
{
    use Queueable;

    // A CRM timeout may already have created a lead. An operator must reconcile it.
    public int $tries = 1;

    public int $timeout = 120;

    public function __construct(public readonly int $caseId) {}

    public function handle(): void
    {
        $service = new EdnaAssistance;
        $case = DB::table('edna_assistance_cases')->find($this->caseId);
        if (! $case || ! $case->answer || $case->crm_state !== 'pending'
            || ! $service->allowed(Crypt::decryptString($case->recipient))) {
            return;
        }
        if (! $service->modeMatches($case)) {
            $this->record(['crm_state' => 'review', 'reason' => 'pilot_mode_changed']);

            return;
        }
        $decision = json_decode($case->decision, true, 16, JSON_THROW_ON_ERROR);
        if ($decision['action'] === 'landing') {
            if (! config('edna.assistance_send_enabled')) {
                $this->record(['crm_state' => 'preview']);

                return;
            }
            DB::transaction(function () use ($case, $decision) {
                $segment = $decision['organism'] === 'caja_cordoba' ? 'cordoba_jubilado_caja' : 'cordoba_jubilado_anses_bancor';
                $url = 'https://redunisol.com.ar/prestamos-para-jubilados/jubilados-cordoba?'.http_build_query([
                    'utm_source' => 'whatsapp', 'utm_medium' => 'messaging', 'utm_campaign' => 'web_whatsapp_router', 'utm_content' => $segment,
                ], '', '&', PHP_QUERY_RFC3986);
                $attribution = (new EdnaAssistance)->attribution($case);
                if ($attribution['journey_id']) {
                    $url .= '&ref='.$attribution['journey_id'];
                }
                $claimed = DB::table('edna_assistance_cases')->where('id', $case->id)->where('crm_state', 'pending')->update([
                    'crm_state' => 'not_applicable', 'link_state' => 'waiting', 'link_request_id' => (string) Str::uuid(),
                    'link_text' => Crypt::encryptString('Podés continuar tu solicitud acá: '.$url), 'updated_at' => now(),
                ]);
                if ($claimed) {
                    Queue::connection('edna_assistance')->push(new SendEdnaAssistance($case->id, true), '', 'edna-assistance');
                }
            });

            return;
        }
        if (! config('edna.assistance_crm_enabled')) {
            $this->record(['crm_state' => 'preview']);

            return;
        }
        // Includes forms accepted by the web while their CRM job is still queued.
        if ($service->hasQueuedForm(Crypt::decryptString($case->recipient))) {
            $this->record(['crm_state' => 'review', 'reason' => 'form_after_assistance']);

            return;
        }
        // A web form or advisor may have appeared after the assisted Flow was sent.
        $context = $case->is_test ? ['evidence' => []] : app(WhatsAppSalesContext::class)->resolve(Crypt::decryptString($case->recipient), [
            'deal_categories' => [1, 5], 'form_since' => now()->subDays(60)->toIso8601String(),
            'advisor_since' => now()->subDays(30)->toIso8601String(), 'any_form_since' => now()->subDays(30)->toIso8601String(),
        ]);
        if ($context['evidence']) {
            $this->record(['crm_state' => 'review', 'reason' => 'management_after_assistance']);

            return;
        }
        $url = (string) config('edna.assistance_processing_url');
        if ($case->is_test && ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_assistance_pilot/')) {
            $this->record(['crm_state' => 'review', 'reason' => 'test_endpoint_required']);

            return;
        }
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)) {
            $this->record(['crm_state' => 'review', 'reason' => 'processing_not_configured']);

            return;
        }
        $claimed = DB::table('edna_assistance_cases')->where('id', $case->id)->where('crm_state', 'pending')
            ->update(['crm_state' => 'processing', 'updated_at' => now()]);
        if (! $claimed) {
            return;
        }
        try {
            $response = Http::asJson()->acceptJson()->connectTimeout(5)->timeout(90)->withoutRedirecting()->post($url, [
                'case_id' => $case->request_id, 'phone' => Crypt::decryptString($case->recipient), 'dry_run' => false,
                'test_mode' => (bool) $case->is_test,
                'answer' => json_decode(Crypt::decryptString($case->answer), true, 16, JSON_THROW_ON_ERROR),
                'received_at' => $case->response_received_at, 'attribution' => $service->attribution($case),
            ]);
            $result = $response->json();
            if (! $response->successful() || ($result['ok'] ?? null) !== true || ($result['case_id'] ?? '') !== $case->request_id) {
                throw new \RuntimeException('Invalid assisted intake acknowledgement.');
            }
            $action = $result['action'] ?? '';
            if (! in_array($action, ['disabled', 'review', 'dry_run', 'queued', 'manual_review', 'rejected', 'already_processed', 'test_created'], true)) {
                throw new \RuntimeException('Invalid assisted intake action.');
            }
            $state = in_array($action, ['disabled', 'review'], true) ? 'review' : ($action === 'dry_run' ? 'preview' : 'synced');
            $this->record(['crm_state' => $state,
                'lead_id' => $result['lead_id'] ?? null, 'contact_id' => $result['contact_id'] ?? null,
                'reason' => $result['reason'] ?? null, 'state' => $state === 'synced' ? 'completed' : 'answered']);
        } catch (Throwable) {
            $this->record(['crm_state' => 'unknown', 'reason' => 'crm_acknowledgement_uncertain']);
        }
    }

    private function record(array $fields): void
    {
        DB::table('edna_assistance_cases')->where('id', $this->caseId)->update($fields + ['updated_at' => now()]);
    }
}
