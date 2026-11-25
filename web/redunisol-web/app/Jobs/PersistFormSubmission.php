<?php

namespace App\Jobs;

use App\Actions\SubmitFormToKestra;
use App\Exceptions\RetryableFormPersistenceFailure;
use App\Services\JourneyLedger;
use App\Services\MetaConversionsApiService;
use App\Services\WebFormReceipt;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use RuntimeException;

class PersistFormSubmission implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    // Solo se reintentan las fallas en las que es seguro que el lead no se creo
    // (RetryableFormPersistenceFailure). Cualquier otra falla termina el job en el
    // primer intento: reintentarla podria duplicar el lead en Bitrix24.
    public int $tries = 4;

    public int $timeout = 75;

    public bool $failOnTimeout = true;

    // Esperas largas: el limite de pedidos de Bitrix24 es de todo el portal y una
    // caida de Kestra puede durar varios minutos. La persona no espera este job.
    public array $backoff = [300, 900, 1800];

    // Rechazos de Bitrix24 que no procesan el pedido: limite de pedidos, 502/503 y
    // errores de conexion. Se comparan contra el mensaje que devuelve Kestra.
    private const BITRIX_TRANSIENT_PATTERN = '/QUERY_LIMIT_EXCEEDED|Too many requests|Bitrix24 devolvio HTTP 50[23]|Error de red contra Bitrix24/i';

    // Respuestas HTTP en las que el pedido no llego a Kestra: 502/503 del proxy y
    // 521/522/523/525/526 de Cloudflare (origen caido, inalcanzable o error TLS).
    // 500, 504, 520 y 524 quedan afuera: Kestra pudo haber creado el lead.
    private const KESTRA_UNREACHED_STATUSES = [502, 503, 521, 522, 523, 525, 526];

    // Errores de cURL sin conexion establecida: DNS, conexion rechazada, TLS.
    // El 28 (tiempo agotado) queda afuera: Kestra sigue y crea el lead igual.
    private const CURL_UNREACHED_ERRORS = [6, 7, 35];

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
        try {
            $this->persist($submitFormToKestra, $metaConversionsApi);
        } catch (RetryableFormPersistenceFailure $error) {
            throw $error;
        } catch (\Throwable $error) {
            $this->fail($error);
        }
    }

    private function persist(
        SubmitFormToKestra $submitFormToKestra,
        MetaConversionsApiService $metaConversionsApi,
    ): void {
        try {
            $response = $submitFormToKestra->execute($this->input, $this->prequalification);
        } catch (ConnectionException $error) {
            if ($this->isUnreachedConnectionError($error)) {
                throw new RetryableFormPersistenceFailure('No se pudo conectar con Kestra.', 0, $error);
            }

            throw $error;
        }

        $body = $response->json();
        try {
            app(WebFormReceipt::class)->result($this->input, is_array($body) ? $body : null, $response->successful());
        } catch (\Throwable $error) {
            // A local projection failure must not retry a confirmed external CRM write.
            report($error);
        }
        app(JourneyLedger::class)->record('form.persistence_result', [
            'http_status' => $response->status(),
            'attempt' => $this->attempts(),
            'result' => is_array($body) ? array_intersect_key($body, array_flip(['ok', 'action', 'reason', 'message', 'execution_id', 'lead_id', 'contact_id'])) : null,
        ], ($this->input['_journey_links'] ?? []) + array_filter([
            'lead_id' => $body['lead_id'] ?? null, 'contact_id' => $body['contact_id'] ?? null,
            'execution_id' => $body['execution_id'] ?? null,
        ]), 'kestra.form');
        app(JourneyLedger::class)->flush();
        if ($response->failed()) {
            if (in_array($response->status(), self::KESTRA_UNREACHED_STATUSES, true)) {
                throw new RetryableFormPersistenceFailure(
                    "Kestra no recibio el formulario (HTTP {$response->status()}).",
                    0,
                    $response->toException(),
                );
            }

            $response->throw();
        }

        if (! is_array($body) || ($body['ok'] ?? false) !== true) {
            if ($this->isTransientBitrixRejection($body)) {
                throw new RetryableFormPersistenceFailure('Bitrix24 rechazo el lead de forma pasajera: '.$body['message']);
            }

            throw new RuntimeException('Kestra no pudo persistir el formulario en Bitrix24.');
        }

        if ($this->qualified) {
            $metaConversionsApi->sendLead($this->input, $this->clientContext);
        }
    }

    public function failed(?\Throwable $error): void
    {
        app(WebFormReceipt::class)->failed($this->input);
        app(JourneyLedger::class)->record('form.persistence_failed', [
            'attempts' => $this->attempts(),
        ], $this->input['_journey_links'] ?? [], 'kestra.form');
        app(JourneyLedger::class)->flush();
    }

    private function isTransientBitrixRejection(mixed $body): bool
    {
        if (! is_array($body) || ! is_string($body['message'] ?? null)) {
            return false;
        }

        // Con lead_id, Bitrix24 ya creo el lead: reintentar lo duplicaria.
        if (($body['lead_id'] ?? '') !== '' && $body['lead_id'] !== null) {
            return false;
        }

        return preg_match(self::BITRIX_TRANSIENT_PATTERN, $body['message']) === 1;
    }

    private function isUnreachedConnectionError(ConnectionException $error): bool
    {
        if (preg_match('/cURL error (\d+):/', $error->getMessage(), $match) !== 1) {
            return false;
        }

        return in_array((int) $match[1], self::CURL_UNREACHED_ERRORS, true);
    }
}
