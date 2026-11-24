<?php

namespace App\Http\Controllers;

use App\Http\Requests\FormSubmissionRequest;
use App\Services\AttributionJourney;
use App\Services\JourneyLedger;
use App\Services\WebFormHttpAttempt;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class FormSubmissionController extends Controller
{
    public function __invoke(FormSubmissionRequest $request): JsonResponse
    {
        $key = $request->header('Idempotency-Key') ?? (string) Str::uuid();
        if (! Str::isUuid($key)) {
            return response()->json(['ok' => false, 'reason' => 'invalid_submission_key'], 422);
        }
        $input = (new AttributionJourney)->resolveForm($request, $request->validated());
        $input['_form_received_at'] = now()->toIso8601String();
        $input['_journey_links'] = app(JourneyLedger::class)->context($request) + [
            'submission_id' => (string) Str::uuid(),
            'phone_hash' => (new AttributionJourney)->phoneHash((string) ($input['celular'] ?? '')),
        ];
        $input['_journey_links']['journey_id'] = $input['attribution']['journey_id'] ?? null;
        if (! empty($input['journey_page_id'])) {
            $input['_journey_links']['page_id'] = $input['journey_page_id'];
        }
        unset($input['journey_page_id']);
        $attempts = app(WebFormHttpAttempt::class);
        try {
            $attempt = $attempts->open($key, $request->validated(), $input, [
                'ip' => $request->ip(), 'user_agent' => $request->userAgent(),
                'fbp' => $request->cookie('_fbp'), 'fbc' => $request->cookie('_fbc'),
            ]);
            if ($attempt['new']) {
                app(JourneyLedger::class)->recordFormReceived($input);
            }

            return response()->json($attempt['response'] ?? $attempts->complete($key));
        } catch (HttpException $error) {
            return response()->json(['ok' => false, 'message' => $error->getMessage()], $error->getStatusCode(), $error->getHeaders());
        } catch (Throwable $error) {
            logger()->warning('Web form processing unavailable.', ['error' => $error::class]);

            return $this->loadFailure(503);
        }
    }

    private function loadFailure(int $status): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'action' => 'error',
            'reason' => 'form_load_failed',
            'message' => 'Estamos teniendo problemas técnicos para recibir tu solicitud. Por favor, intentá nuevamente en unos minutos.',
            'qualified' => false,
        ], $status >= 400 ? $status : 502);
    }
}
