<?php

namespace App\Jobs;

use App\Actions\SubmitFormToKestra;
use App\Services\MetaConversionsApiService;
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

        if ($response->failed()) {
            $response->throw();
        }

        $body = $response->json();
        if (! is_array($body) || ($body['ok'] ?? false) !== true) {
            throw new RuntimeException('Kestra no pudo persistir el formulario en Bitrix24.');
        }

        if ($this->qualified) {
            $metaConversionsApi->sendLead($this->input, $this->clientContext);
        }
    }
}
