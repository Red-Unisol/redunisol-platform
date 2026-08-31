<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Throwable;

class HerramientasController extends Controller
{
    public function index()
    {
        if (! $this->isEnabled()) {
            return $this->renderDisabledPage();
        }

        return $this->renderApp();
    }

    public function credixsa()
    {
        if (! $this->isEnabled()) {
            return $this->renderDisabledPage();
        }

        return $this->renderApp('credixsa');
    }

    private function renderApp(string $page = 'home')
    {
        $tools = collect(config('tools.catalog', []))
            ->map(function (array $tool): array {
                if (($tool['id'] ?? null) === 'consulta-renovacion-cruz-del-eje') {
                    $tool['endpoint'] = route('tools.consulta-renovacion-cruz-del-eje');
                }
                if (($tool['id'] ?? null) === 'consulta-tope-descuento-caja') {
                    $tool['endpoint'] = route('tools.consulta-tope-descuento-caja');
                }
                if (($tool['id'] ?? null) === 'consulta-quiebra-credix') {
                    $tool['endpoint'] = route('tools.consulta-quiebra-credix');
                    $tool['href'] = route('credixsa');
                }
                if (($tool['id'] ?? null) === 'consulta-empleador') {
                    $tool['endpoint'] = route('tools.consulta-empleador');
                }
                if (($tool['id'] ?? null) === 'consulta-cuad') {
                    $tool['endpoint'] = route('tools.consulta-cuad');
                }
                if (($tool['id'] ?? null) === 'bcra-central-deudores') {
                    $tool['href'] = config('tools.bcra.panel_url');
                }

                return $tool;
            })
            ->values();

        return view('app', [
            'payload' => [
                'branding' => config('tools.branding', []),
                'tools' => $tools,
                'page' => $page,
            ],
        ]);
    }

    private function isEnabled(): bool
    {
        return (bool) config('tools.enabled', true);
    }

    private function renderDisabledPage()
    {
        return response()
            ->view('disabled', status: 503);
    }

    private function disabledJsonResponse(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'message' => 'Esta pagina de desarrollo no esta disponible en este momento.',
            'error' => 'development_site_disabled',
        ], 503);
    }

    public function consultaRenovacionCruzDelEje(Request $request): JsonResponse
    {
        if (! $this->isEnabled()) {
            return $this->disabledJsonResponse();
        }

        $validated = $request->validate([
            'cuil' => ['required', 'string', 'regex:/^(\d{2}-?\d{8}-?\d|\d{11})$/'],
        ]);

        $targetUrl = (string) config('tools.proxy.consulta_renovacion_url', '');

        if ($targetUrl === '') {
            return response()->json([
                'ok' => false,
                'message' => 'La herramienta no esta configurada todavia en el servidor.',
                'error' => 'tool_not_configured',
            ], 500);
        }

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout((int) config('tools.proxy.timeout_seconds', 30))
                ->post($targetUrl, [
                    'cuil' => trim($validated['cuil']),
                ]);
        } catch (Throwable $exception) {
            return response()->json([
                'ok' => false,
                'message' => 'No pudimos conectar con el servicio de analisis en este momento.',
                'error' => 'upstream_unavailable',
                'detail' => $exception->getMessage(),
            ], 502);
        }

        if (! $response->successful()) {
            return response()->json([
                'ok' => false,
                'message' => 'El servicio devolvio una respuesta inesperada.',
                'error' => 'upstream_error',
                'status' => $response->status(),
                'body' => $response->json() ?? $response->body(),
            ], 502);
        }

        return response()->json($response->json());
    }

    public function consultaTopeDescuentoCaja(Request $request): JsonResponse
    {
        if (! $this->isEnabled()) {
            return $this->disabledJsonResponse();
        }

        $validated = $request->validate([
            'cuil' => ['required', 'string', 'regex:/^(\d{2}-?\d{8}-?\d|\d{11})$/'],
        ]);

        $targetUrl = (string) config('tools.proxy.tope_descuento_caja_url', '');

        if ($targetUrl === '') {
            return response()->json([
                'ok' => false,
                'message' => 'La herramienta no esta configurada todavia en el servidor.',
                'error' => 'tool_not_configured',
            ], 500);
        }

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout((int) config('tools.proxy.timeout_seconds', 30))
                ->post($targetUrl, [
                    'cuil' => trim($validated['cuil']),
                ]);
        } catch (Throwable $exception) {
            return response()->json([
                'ok' => false,
                'message' => 'No pudimos conectar con el servicio de caja en este momento.',
                'error' => 'upstream_unavailable',
                'detail' => $exception->getMessage(),
            ], 502);
        }

        if (! $response->successful()) {
            return response()->json([
                'ok' => false,
                'message' => 'El servicio devolvio una respuesta inesperada.',
                'error' => 'upstream_error',
                'status' => $response->status(),
                'body' => $response->json() ?? $response->body(),
            ], 502);
        }

        return response()->json($response->json());
    }

    public function consultaQuiebraCredix(Request $request): JsonResponse
    {
        if (! $this->isEnabled()) {
            return $this->disabledJsonResponse();
        }

        $validator = Validator::make($request->all(), [
            'cuit' => ['nullable', 'string', 'regex:/^(?:\d{7,11}|\d{2}-?\d{8}-?\d)$/'],
            'nombre' => ['nullable', 'string', 'max:160'],
        ]);

        $validator->after(function ($validator) use ($request): void {
            $cuit = trim((string) $request->input('cuit', ''));
            $nombre = trim((string) $request->input('nombre', ''));

            if ($cuit === '' && $nombre === '') {
                $validator->errors()->add('cuit', 'Ingresa un CUIT o un nombre para consultar.');
            }
        });

        $validated = $validator->validate();

        $targetUrl = (string) config('tools.proxy.consulta_quiebra_credix_url', '');

        if ($targetUrl === '') {
            return response()->json([
                'ok' => false,
                'message' => 'La herramienta no esta configurada todavia en el servidor.',
                'error' => 'tool_not_configured',
            ], 500);
        }

        $payload = array_filter([
            'cuit' => trim((string) ($validated['cuit'] ?? '')),
            'nombre' => trim((string) ($validated['nombre'] ?? '')),
        ], fn ($value) => $value !== '');

        $cacheUrl = (string) config('tools.proxy.consulta_quiebra_credix_cache_url', '');
        if ($cacheUrl !== '') {
            try {
                $cacheResponse = Http::acceptJson()
                    ->asJson()
                    ->timeout((int) config('tools.proxy.cache_timeout_seconds', 3))
                    ->post($cacheUrl, $payload);

                if ($cacheResponse->successful()) {
                    return response()->json($cacheResponse->json());
                }
            } catch (Throwable) {
                // Cache misses and cache service outages fall back to the full Kestra flow.
            }
        }

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout((int) config('tools.proxy.timeout_seconds', 30))
                ->post($targetUrl, $payload);
        } catch (Throwable $exception) {
            return response()->json([
                'ok' => false,
                'message' => 'No pudimos conectar con el servicio de quiebra en este momento.',
                'error' => 'upstream_unavailable',
                'detail' => $exception->getMessage(),
            ], 502);
        }

        if (! $response->successful()) {
            return response()->json([
                'ok' => false,
                'message' => 'El servicio devolvio una respuesta inesperada.',
                'error' => 'upstream_error',
                'status' => $response->status(),
                'body' => $response->json() ?? $response->body(),
            ], 502);
        }

        return response()->json($response->json());
    }

    public function consultaEmpleador(Request $request): JsonResponse
    {
        if (! $this->isEnabled()) {
            return $this->disabledJsonResponse();
        }

        $validated = $request->validate([
            'identificador' => ['required', 'string', 'regex:/^(?:\d{7,11}|\d{2}-?\d{8}-?\d)$/'],
        ]);

        $targetUrl = (string) config('tools.proxy.consulta_empleador_url', '');

        if ($targetUrl === '') {
            return response()->json([
                'ok' => false,
                'message' => 'La herramienta no esta configurada todavia en el servidor.',
                'error' => 'tool_not_configured',
            ], 500);
        }

        $identifier = trim($validated['identificador']);
        $digits = preg_replace('/\D+/', '', $identifier) ?? '';
        $payload = strlen($digits) === 11
            ? ['cuil' => $identifier]
            : ['dni' => $identifier];

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout((int) config('tools.proxy.timeout_seconds', 30))
                ->post($targetUrl, $payload);
        } catch (Throwable $exception) {
            return response()->json([
                'ok' => false,
                'message' => 'No pudimos conectar con el servicio de empleador en este momento.',
                'error' => 'upstream_unavailable',
                'detail' => $exception->getMessage(),
            ], 502);
        }

        if (! $response->successful()) {
            return response()->json([
                'ok' => false,
                'message' => 'El servicio devolvio una respuesta inesperada.',
                'error' => 'upstream_error',
                'status' => $response->status(),
                'body' => $response->json() ?? $response->body(),
            ], 502);
        }

        return response()->json($response->json());
    }

    public function consultaCuad(Request $request): JsonResponse
    {
        if (! $this->isEnabled()) {
            return $this->disabledJsonResponse();
        }

        $validated = $request->validate([
            'cuil' => ['required', 'string', 'regex:/^(\d{2}-?\d{8}-?\d|\d{11})$/'],
        ]);

        $targetUrl = (string) config('tools.proxy.consulta_cuad_url', '');

        if ($targetUrl === '') {
            return response()->json([
                'ok' => false,
                'message' => 'La herramienta no esta configurada todavia en el servidor.',
                'error' => 'tool_not_configured',
            ], 500);
        }

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout((int) config('tools.proxy.timeout_seconds', 30))
                ->post($targetUrl, [
                    'cuil' => trim($validated['cuil']),
                ]);
        } catch (Throwable $exception) {
            return response()->json([
                'ok' => false,
                'message' => 'No pudimos conectar con el servicio de CUAD en este momento.',
                'error' => 'upstream_unavailable',
                'detail' => $exception->getMessage(),
            ], 502);
        }

        if (! $response->successful()) {
            return response()->json([
                'ok' => false,
                'message' => 'El servicio devolvio una respuesta inesperada.',
                'error' => 'upstream_error',
                'status' => $response->status(),
                'body' => $response->json() ?? $response->body(),
            ], 502);
        }

        return response()->json($response->json());
    }
}
