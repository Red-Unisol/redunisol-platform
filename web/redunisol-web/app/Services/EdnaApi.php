<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class EdnaApi
{
    public function post(string $method, array $payload): Response
    {
        if (! config('edna.api_key')) {
            throw new RuntimeException('Edna API credential is missing.');
        }
        try {
            // No automatic retry: a timed-out schedule may already have sent the Flow.
            return Http::asJson()->acceptJson()->withHeaders(['X-API-KEY' => config('edna.api_key')])
                ->connectTimeout(5)->timeout(12)->withoutRedirecting()
                ->post('https://app.edna.io/api/'.$method, $payload);
        } catch (Throwable) {
            throw new RuntimeException('Edna API request failed; inspect the send ledger.');
        }
    }

    public function assertCascade(object $send): void
    {
        $response = $this->post('cascade/get-all', []);
        if ($response->status() !== 200 || ! is_array($response->json())) {
            throw new RuntimeException('Edna cascade could not be verified.');
        }
        foreach ($response->json() as $cascade) {
            $stages = $cascade['stages'] ?? [];
            if ((string) ($cascade['id'] ?? '') === $send->cascade_id && ($cascade['status'] ?? '') === 'ACTIVE'
                && count($stages) === 1 && empty($stages[0]['stages'])
                && (string) ($stages[0]['subject']['id'] ?? '') === $send->subject_id
                && empty($stages[0]['subject']['locked'])) {
                return;
            }
        }
        throw new RuntimeException('Edna cascade does not match the router channel.');
    }
}
