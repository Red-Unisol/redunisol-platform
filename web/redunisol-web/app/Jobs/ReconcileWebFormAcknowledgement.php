<?php

namespace App\Jobs;

use App\Actions\SubmitFormToKestra;
use App\Services\EdnaBitrix;
use App\Services\JourneyLedger;
use App\Services\MetaConversionsApiService;
use App\Services\WebFormReceipt;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class ReconcileWebFormAcknowledgement implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 15;

    public int $timeout = 75;

    public bool $qualified = false;

    public ?string $guardedPayload = null;

    public array $clientContext = [];

    public function __construct(public readonly array $input, bool $qualified = false, array $clientContext = [], ?string $guardedPayload = null)
    {
        $this->qualified = $qualified;
        $this->guardedPayload = $guardedPayload;
        $this->clientContext = $clientContext;
    }

    public function backoff(): array
    {
        return [60, 120, 300, 600, 1200, 1800];
    }

    public function handle(EdnaBitrix $bitrix, WebFormReceipt $receipts): void
    {
        $id = $this->input['_journey_links']['submission_id'];
        $receipt = DB::table('web_form_receipts')->where('id', $id)->first();
        if (! $receipt || ! $receipt->crm_dispatched_at || $receipt->crm_ack_conflict_at || $receipt->state === 'failed') {
            return;
        }
        if ($receipt->state === 'synced') {
            $this->reportLead($receipts);

            return;
        }
        if ($receipt->crm_payload_digest && ! $receipt->crm_write_claimed_at) {
            // Even simultaneous sends must claim the one CRM write at the receiver.
            if ($this->guardedPayload === null || ! hash_equals($receipt->crm_payload_digest, hash('sha256', $this->guardedPayload))) {
                throw new RuntimeException('Original guarded CRM payload unavailable.');
            }
            $response = app(SubmitFormToKestra::class)->execute($this->input, [], $this->guardedPayload);
            $body = $response->json();
            if (! $response->successful() || ! is_array($body) || ($body['ok'] ?? false) !== true) {
                throw new RuntimeException('Guarded CRM delivery has not been acknowledged.');
            }
            if (! $receipts->result($this->input, $body, true)) {
                throw new RuntimeException('Guarded CRM acknowledgement could not be verified.');
            }
            $this->reportLead($receipts);
            $this->logReconciled($id, (string) $body['lead_id']);

            return;
        }

        $identityField = 'UF_CRM_1693840106704';
        $leads = $bitrix->call('crm.lead.list', [
            'filter' => ['=ORIGINATOR_ID' => 'redunisol-web', '=ORIGIN_ID' => $id],
            'select' => ['ID', 'CONTACT_ID', 'ORIGINATOR_ID', 'ORIGIN_ID', $identityField],
        ]);
        if (! is_array($leads) || count($leads) !== 1) {
            throw new RuntimeException('Unique web submission acknowledgement unavailable.');
        }
        $lead = reset($leads);
        $identity = $receipts->identityHash((string) ($lead[$identityField] ?? ''));
        if (($lead['ORIGINATOR_ID'] ?? null) !== 'redunisol-web' || ($lead['ORIGIN_ID'] ?? null) !== $id
            || ! $identity || ! hash_equals((string) $receipt->identity_hash, $identity)
            || ! preg_match('/^[1-9][0-9]*$/D', (string) ($lead['ID'] ?? ''))
            || ! preg_match('/^[1-9][0-9]*$/D', (string) ($lead['CONTACT_ID'] ?? ''))) {
            throw new RuntimeException('Web submission acknowledgement inconsistent.');
        }
        if ($receipts->result($this->input, ['ok' => true, 'lead_id' => $lead['ID'], 'contact_id' => $lead['CONTACT_ID']], true)) {
            $this->reportLead($receipts);
            $this->logReconciled($id, (string) $lead['ID']);
        }
    }

    private function logReconciled(string $id, string $lead): void
    {
        $ledger = app(JourneyLedger::class);
        $ledger->record('form.persistence_reconciled', [], ['submission_id' => $id, 'lead_id' => $lead], 'kestra.form');
        $ledger->flush();
    }

    private function reportLead(WebFormReceipt $receipts): void
    {
        if ($this->qualified) {
            $receipts->reportLead($this->input, $this->clientContext, app(MetaConversionsApiService::class));
        }
    }

    public function failed(?\Throwable $exception): void
    {
        $state = app(WebFormReceipt::class)->failed($this->input, finalCheck: true);
        if (in_array($state, ['uncertain', 'failed'], true)) {
            $ledger = app(JourneyLedger::class);
            $ledger->record('form.persistence_unverified', ['receipt_state' => $state], $this->input['_journey_links'] ?? [], 'kestra.form');
            $ledger->flush();
        }
    }
}
