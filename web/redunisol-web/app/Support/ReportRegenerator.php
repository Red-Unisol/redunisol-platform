<?php

namespace App\Support;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class ReportRegenerator
{
    private const TERMINAL_STATES = ['SUCCESS', 'WARNING', 'FAILED', 'KILLED', 'CANCELLED'];

    public function configured(): bool
    {
        return filled(config('reports.kestra_url'))
            && filled(config('reports.kestra_username'))
            && filled(config('reports.kestra_password'));
    }

    public function start(string $key): array
    {
        $definition = app(ReportCatalog::class)->definition($key);
        abort_unless($definition, 404);

        if (! $this->configured()) {
            throw new RuntimeException('La regeneración no está configurada.');
        }

        $lock = Cache::lock($this->cacheKey($key).':lock', 30);
        if (! $lock->get()) {
            throw new RuntimeException('Ya se está solicitando la regeneración de este informe.');
        }

        try {
            $current = $this->refreshStatus($key);
            if ($current['busy']) {
                return $current;
            }

            // A lost response may still have started a job. Do not retry automatically.
            Cache::put($this->cacheKey($key), ['state' => 'UNKNOWN', 'busy' => true], now()->addMinutes(2));
            $namespace = config('reports.namespace_prefix').'.'.$definition['domain'];
            $response = $this->client()->asMultipart()->post(
                $this->api().'/executions/'.rawurlencode($namespace).'/'.$definition['flow'],
                []
            );
            $id = $response->json('id');
            if (! $response->successful() || ! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{10,100}$/', $id)) {
                throw new RuntimeException('No se pudo confirmar el inicio. Esperá dos minutos antes de volver a intentar.');
            }

            $state = ['id' => $id, 'state' => 'CREATED', 'busy' => true];
            Cache::put($this->cacheKey($key), $state, now()->addDays(2));

            return $state;
        } finally {
            $lock->release();
        }
    }

    public function status(string $key): array
    {
        $state = Cache::get($this->cacheKey($key), ['state' => null, 'busy' => false]);
        if (! $state['busy'] || empty($state['id'])) {
            return $state;
        }

        // Polling in another tab must not overwrite a newly started execution.
        $lock = Cache::lock($this->cacheKey($key).':lock', 30);
        if (! $lock->get()) {
            return $state;
        }

        try {
            return $this->refreshStatus($key);
        } finally {
            $lock->release();
        }
    }

    private function refreshStatus(string $key): array
    {
        $state = Cache::get($this->cacheKey($key), ['state' => null, 'busy' => false]);
        if (! $state['busy'] || empty($state['id'])) {
            return $state;
        }

        try {
            $response = $this->client()->get($this->api().'/executions/'.rawurlencode($state['id']));
            if (! $response->successful()) {
                return $state;
            }
            $current = $response->json('state.current');
            if (! is_string($current)) {
                return $state;
            }

            $state['state'] = $current === 'SUCCESS' && $response->json('outputs.ok') === false ? 'FAILED' : $current;
            $state['busy'] = ! in_array($state['state'], self::TERMINAL_STATES, true);
            Cache::put($this->cacheKey($key), $state, now()->addDays(2));
        } catch (ConnectionException) {
            // Keep the execution ID so a temporary outage cannot start duplicate jobs.
        }

        return $state;
    }

    private function client(): PendingRequest
    {
        return Http::acceptJson()
            ->withBasicAuth(config('reports.kestra_username'), config('reports.kestra_password'))
            ->connectTimeout(3)->timeout(10);
    }

    private function api(): string
    {
        return rtrim(config('reports.kestra_url'), '/').'/api/v1/'.rawurlencode(config('reports.kestra_tenant'));
    }

    private function cacheKey(string $key): string
    {
        return 'report-regeneration:'.hash('sha256', config('reports.namespace_prefix').'|'.$key);
    }
}
