<?php

namespace App\Http\Controllers;

use App\Actions\PrequalifyFormWithKestra;
use App\Actions\SubmitFormToKestra;
use App\Http\Requests\FormSubmissionRequest;
use App\Services\MetaConversionsApiService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use RuntimeException;
use Throwable;

class FormSubmissionController extends Controller
{
    public function __construct(
        private readonly SubmitFormToKestra $submitFormToKestra,
        private readonly PrequalifyFormWithKestra $prequalifyFormWithKestra,
        private readonly MetaConversionsApiService $metaConversionsApi,
    ) {
    }

    public function __invoke(FormSubmissionRequest $request): JsonResponse
    {
        $prequalificationResponse = null;
        try {
            $prequalificationResponse = $this->prequalifyFormWithKestra->execute(
                $request->validated(),
            );
        } catch (Throwable $exception) {
            report($exception);
        }

        try {
            $response = $this->submitFormToKestra->execute($request->validated());

            if ($response->failed()) {
                return $this->loadFailure($response->status());
            }

            $body = $response->json();
            if (! is_array($body) || ($body['ok'] ?? false) !== true) {
                return $this->loadFailure(502);
            }

            $prequalification = $prequalificationResponse?->json();
            $prequalificationAvailable = $prequalificationResponse !== null
                && $prequalificationResponse->successful()
                && is_array($prequalification)
                && ($prequalification['ok'] ?? false) === true;

            if (! $prequalificationAvailable) {
                return response()->json([
                    ...$body,
                    'ok' => true,
                    'qualified' => false,
                    'prequalified' => false,
                    'action' => 'not_qualified',
                    'reason' => 'prequalification_unavailable',
                    'message' => 'Recibimos tu solicitud, pero no pudimos verificarla automáticamente. La revisaremos de forma manual.',
                ]);
            }

            $qualified = ($prequalification['prequalified'] ?? false) === true;
            $result = [
                ...$body,
                'ok' => true,
                'qualified' => $qualified,
                'prequalified' => $qualified,
                'action' => $qualified ? 'qualified' : 'rejected',
                'reason' => (string) ($prequalification['reason'] ?? ''),
                'message' => (string) ($prequalification['message'] ?? ''),
                'rule_version' => (string) ($prequalification['rule_version'] ?? ''),
            ];

            if ($qualified) {
                $this->metaConversionsApi->sendLead($request, $request->validated());
            }

            return response()->json($result);
        } catch (RuntimeException $exception) {
            report($exception);

            return $this->loadFailure(503);
        } catch (ConnectionException $exception) {
            report($exception);

            return $this->loadFailure(502);
        } catch (RequestException $exception) {
            report($exception);

            return $this->loadFailure($exception->response?->status() ?? 502);
        } catch (Throwable $exception) {
            report($exception);

            return $this->loadFailure(500);
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
