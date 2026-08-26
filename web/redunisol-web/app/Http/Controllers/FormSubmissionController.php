<?php

namespace App\Http\Controllers;

use App\Actions\PrequalifyFormWithKestra;
use App\Http\Requests\FormSubmissionRequest;
use App\Jobs\PersistFormSubmission;
use Illuminate\Http\JsonResponse;
use Throwable;

class FormSubmissionController extends Controller
{
    public function __construct(
        private readonly PrequalifyFormWithKestra $prequalifyFormWithKestra,
    ) {}

    public function __invoke(FormSubmissionRequest $request): JsonResponse
    {
        $input = $request->validated();
        $prequalificationResponse = null;

        try {
            $prequalificationResponse = $this->prequalifyFormWithKestra->execute($input);
        } catch (Throwable $exception) {
            report($exception);
        }

        $prequalification = $prequalificationResponse?->json();
        $prequalificationAvailable = $prequalificationResponse !== null
            && $prequalificationResponse->successful()
            && is_array($prequalification)
            && ($prequalification['ok'] ?? false) === true;
        $qualified = $prequalificationAvailable
            && ($prequalification['prequalified'] ?? false) === true;
        $routeToWhatsapp = $qualified
            && ($prequalification['route_to_whatsapp'] ?? true) === true;

        try {
            PersistFormSubmission::dispatch(
                input: $input,
                qualified: $qualified,
                prequalification: [
                    'available' => $prequalificationAvailable,
                    'prequalified' => $qualified,
                    'route_to_whatsapp' => $routeToWhatsapp,
                    'reason' => $prequalificationAvailable ? (string) ($prequalification['reason'] ?? '') : 'prequalification_unavailable',
                    'message' => $prequalificationAvailable ? (string) ($prequalification['message'] ?? '') : '',
                    'rule_version' => $prequalificationAvailable ? (string) ($prequalification['rule_version'] ?? '') : '',
                ],
                clientContext: [
                    'ip' => $request->ip(),
                    'user_agent' => $request->userAgent(),
                    'fbp' => $request->cookie('_fbp'),
                    'fbc' => $request->cookie('_fbc'),
                ],
            );
        } catch (Throwable $exception) {
            report($exception);

            return $this->loadFailure(503);
        }

        if (! $prequalificationAvailable) {
            return response()->json([
                'ok' => true,
                'qualified' => false,
                'prequalified' => false,
                'route_to_whatsapp' => false,
                'action' => 'not_qualified',
                'reason' => 'prequalification_unavailable',
                'message' => 'Recibimos tu solicitud, pero no pudimos verificarla automáticamente. La revisaremos de forma manual.',
                'persistence' => 'queued',
            ]);
        }

        return response()->json([
            'ok' => true,
            'qualified' => $qualified,
            'prequalified' => $qualified,
            'route_to_whatsapp' => $routeToWhatsapp,
            'action' => $routeToWhatsapp ? 'qualified' : 'rejected',
            'reason' => (string) ($prequalification['reason'] ?? ''),
            'message' => (string) ($prequalification['message'] ?? ''),
            'rule_version' => (string) ($prequalification['rule_version'] ?? ''),
            'persistence' => 'queued',
        ]);
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
