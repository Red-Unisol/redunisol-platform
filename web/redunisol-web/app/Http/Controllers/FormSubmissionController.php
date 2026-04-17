<?php

namespace App\Http\Controllers;

use App\Actions\SubmitFormToKestra;
use App\Http\Requests\FormSubmissionRequest;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use RuntimeException;
use Throwable;

class FormSubmissionController extends Controller
{
    public function __construct(
        private readonly SubmitFormToKestra $submitFormToKestra,
    ) {
    }

    public function __invoke(FormSubmissionRequest $request): JsonResponse
    {
        try {
            $response = $this->submitFormToKestra->execute($request->validated());

            if ($response->failed()) {
                return $this->forwardKestraFailure($response->status(), $response->json());
            }

            return response()->json($response->json(), $response->status());
        } catch (RuntimeException $exception) {
            report($exception);

            return response()->json([
                'ok' => false,
                'action' => 'error',
                'reason' => 'misconfigured_backend',
                'message' => 'La integracion con Kestra no esta configurada correctamente.',
                'qualified' => false,
            ], 503);
        } catch (ConnectionException $exception) {
            report($exception);

            return response()->json([
                'ok' => false,
                'action' => 'error',
                'reason' => 'kestra_unreachable',
                'message' => 'No se pudo conectar con Kestra.',
                'qualified' => false,
            ], 502);
        } catch (RequestException $exception) {
            report($exception);

            return $this->forwardKestraFailure(
                $exception->response?->status() ?? 502,
                $exception->response?->json(),
            );
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'ok' => false,
                'action' => 'error',
                'reason' => 'unexpected_error',
                'message' => 'Ocurrio un error inesperado al procesar la solicitud.',
                'qualified' => false,
            ], 500);
        }
    }

    private function forwardKestraFailure(int $status, mixed $body): JsonResponse
    {
        if (is_array($body)) {
            return response()->json($body, $status);
        }

        return response()->json([
            'ok' => false,
            'action' => 'error',
            'reason' => 'kestra_error',
            'message' => 'Kestra devolvio una respuesta invalida.',
            'qualified' => false,
        ], $status >= 400 ? $status : 502);
    }
}