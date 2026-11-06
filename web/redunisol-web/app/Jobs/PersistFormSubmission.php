<?php

namespace App\Jobs;

use App\Actions\SubmitFormToKestra;
use App\Services\JourneyLedger;
use App\Services\MetaConversionsApiService;
use App\Services\WebFormReceipt;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use RuntimeException;

class PersistFormSubmission implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 75;

    public bool $failOnTimeout = true;

    public function __construct(
        public readonly array $input,
        public readonly bool $qualified,
        public readonly array $prequalification = [],
        public readonly array $clientContext = [],
    ) {}

    public function handle(
        SubmitFormToKestra $submitFormToKestra,
        MetaConversionsApiService $metaConversionsApi,
    ): void {
        $response = $submitFormToKestra->execute($this->input, $this->prequalification);

        $body = $response->json();
        try {
            app(WebFormReceipt::class)->result($this->input, is_array($body) ? $body : null, $response->successful());
        } catch (\Throwable $error) {
            // A local projection failure must not retry a confirmed external CRM write.
            report($error);
        }
        app(JourneyLedger::class)->record('form.persistence_result', [
            'http_status' => $response->status(),
            'result' => is_array($body) ? array_intersect_key($body, array_flip(['ok', 'action', 'reason', 'message', 'execution_id', 'lead_id', 'contact_id'])) : null,
        ], ($this->input['_journey_links'] ?? []) + array_filter([
            'lead_id' => $body['lead_id'] ?? null, 'contact_id' => $body['contact_id'] ?? null,
            'execution_id' => $body['execution_id'] ?? null,
        ]), 'kestra.form');
        app(JourneyLedger::class)->flush();
        if ($response->failed()) {
            $response->throw();
        }

        if (! is_array($body) || ($body['ok'] ?? false) !== true) {
            throw new RuntimeException('Kestra no pudo persistir el formulario en Bitrix24.');
        }

        if ($this->qualified) {
            $metaConversionsApi->sendLead($this->input, $this->clientContext);
        }
    }

    public function failed(?\Throwable $error): void
    {
        app(WebFormReceipt::class)->failed($this->input);
        app(JourneyLedger::class)->record('form.persistence_failed', [], $this->input['_journey_links'] ?? [], 'kestra.form');
        app(JourneyLedger::class)->flush();
    }
}
