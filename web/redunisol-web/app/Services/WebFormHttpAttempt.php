<?php

namespace App\Services;

use App\Actions\PrepareWebFormSubmission;
use App\Jobs\PersistFormSubmission;
use App\Jobs\RecoverWebFormHttpAttempt;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class WebFormHttpAttempt
{
    public function open(string $key, array $answers, array $input, array $clientContext): array
    {
        // A reload can start a new journey page and attribution can legitimately refresh.
        // An edited answer, receipt or landing is a new commercial request.
        $values = array_intersect_key($answers, array_flip(['landing_slug', 'cuil', 'email', 'celular',
            'provincia', 'situacion_laboral', 'banco', 'recibo_url', 'terminos']));
        ksort($values);
        $encoded = json_encode($values, JSON_THROW_ON_ERROR);
        $digest = hash_hmac('sha256', $encoded, (string) config('app.key'));

        return DB::transaction(function () use ($key, $digest, $encoded, $answers, $input, $clientContext): array {
            $rows = DB::table('web_form_http_attempts');
            $new = $rows->insertOrIgnore(['request_key' => $key, 'submission_id' => $input['_journey_links']['submission_id'],
                'fingerprint' => $digest, 'expires_at' => now()->addDay(), 'created_at' => now()]) === 1;
            $row = $rows->where('request_key', $key)->lockForUpdate()->firstOrFail();
            $matches = hash_equals($row->fingerprint, $digest) || collect(config('app.previous_keys', []))
                ->contains(fn ($prior) => is_string($prior) && hash_equals($row->fingerprint, hash_hmac('sha256', $encoded, $prior)));
            if (! $matches || CarbonImmutable::parse($row->expires_at)->isPast()) {
                throw new HttpException(409, 'La solicitud anterior venció o contiene otras respuestas.');
            }
            if ($new) {
                $reference = app(WebFormReceipt::class)->register($input);
                $snapshot = compact('input', 'answers', 'clientContext');
                $rows->update(['continuation' => Crypt::encryptString($reference),
                    'snapshot' => Crypt::encryptString(json_encode($snapshot, JSON_THROW_ON_ERROR))]);
                // This database queue shares the receipt transaction. A crashed HTTP request needs no browser retry.
                Queue::connection('edna')->later(now()->addMinutes(2), new RecoverWebFormHttpAttempt($key), '', 'web-forms-reconcile');
            }

            return ['new' => $new, 'response' => $this->response($row->response)];
        }, 3);
    }

    /** Both HTTP and the recovery job evaluate the original encrypted submission. */
    public function complete(string $key): ?array
    {
        $token = (string) Str::uuid();
        $work = DB::transaction(function () use ($key, $token): array {
            $rows = DB::table('web_form_http_attempts')->where('request_key', $key);
            $row = $rows->lockForUpdate()->firstOrFail();
            if ($row->snapshot === null) {
                // The public replay may already have expired after the CRM queue received custody.
                return ['done' => true, 'response' => $this->response($row->response)];
            }
            if ($row->evaluation_until && CarbonImmutable::parse($row->evaluation_until)->isFuture()) {
                throw new HttpException(503, 'La solicitud está siendo evaluada.', null, ['Retry-After' => '5']);
            }
            $leaseSeconds = max(60, (int) config('services.kestra.prequalification_webhook_timeout_seconds', 15) + 30);
            $rows->update(['evaluation_token' => $token, 'evaluation_until' => now()->addSeconds($leaseSeconds)]);

            return ['snapshot' => $row->snapshot, 'reference' => $row->continuation];
        }, 3);
        if (isset($work['done'])) {
            return $work['response'];
        }

        try {
            $snapshot = json_decode(Crypt::decryptString($work['snapshot']), true, flags: JSON_THROW_ON_ERROR);
            [$job, $response] = app(PrepareWebFormSubmission::class)->evaluate($snapshot['input'],
                $snapshot['clientContext'], Crypt::decryptString($work['reference']));
            [$committed, $response] = $this->confirm($key, $token, $job, $response);
        } catch (Throwable $error) {
            DB::table('web_form_http_attempts')->where('request_key', $key)->where('evaluation_token', $token)
                ->update(['evaluation_token' => null, 'evaluation_until' => null]);
            throw $error;
        }
        if ($committed) {
            app(PrepareWebFormSubmission::class)->record($job);
        }

        return $response;
    }

    private function confirm(string $key, string $token, PersistFormSubmission $job, array $response): array
    {
        return DB::transaction(function () use ($key, $token, $job, $response): array {
            $rows = DB::table('web_form_http_attempts')->where('request_key', $key);
            $row = $rows->lockForUpdate()->firstOrFail();
            if ($row->response !== null) {
                return [false, $this->response($row->response)];
            }
            if ($row->evaluation_token !== $token || $row->snapshot === null) {
                throw new RuntimeException('Web form evaluation lease superseded.');
            }
            Queue::connection('edna')->push($job, '', 'web-forms');
            $rows->update(['response' => Crypt::encryptString(json_encode($response, JSON_THROW_ON_ERROR)),
                'snapshot' => null, 'evaluation_token' => null, 'evaluation_until' => null]);

            return [true, $response];
        }, 3);
    }

    private function response(?string $value): ?array
    {
        return $value === null ? null : json_decode(Crypt::decryptString($value), true, flags: JSON_THROW_ON_ERROR);
    }
}
