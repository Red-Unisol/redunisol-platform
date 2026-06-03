<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Response;

class ObjectivesDashboardController extends Controller
{
    public function index()
    {
        if (! $this->isEnabled()) {
            return response()->view('disabled', status: 503);
        }

        return view('app', [
            'payload' => [
                'mode' => 'objectives-dashboard',
                'branding' => config('tools.branding', []),
                'objectives' => [
                    'snapshotEndpoint' => route('objectives.snapshot'),
                    'refreshSeconds' => (int) config('tools.objectives.refresh_seconds', 60),
                ],
            ],
        ]);
    }

    public function snapshot(): JsonResponse
    {
        if (! $this->isEnabled()) {
            return Response::json([
                'ok' => false,
                'message' => 'Esta pagina de desarrollo no esta disponible en este momento.',
                'error' => 'development_site_disabled',
            ], 503);
        }

        $path = $this->snapshotPath();

        if (! is_file($path)) {
            return Response::json([
                'ok' => false,
                'error' => 'snapshot_not_found',
                'message' => 'Todavia no hay un snapshot de objetivos publicado.',
            ], 404)->header('Cache-Control', 'no-store');
        }

        $raw = file_get_contents($path);
        $payload = json_decode((string) $raw, true);

        if (! is_array($payload)) {
            return Response::json([
                'ok' => false,
                'error' => 'snapshot_invalid_json',
                'message' => 'El snapshot de objetivos no tiene JSON valido.',
            ], 500)->header('Cache-Control', 'no-store');
        }

        return Response::json($payload)->header('Cache-Control', 'no-store');
    }

    private function snapshotPath(): string
    {
        $configured = trim((string) config('tools.objectives.snapshot_path', ''));
        $path = $configured !== ''
            ? $configured
            : storage_path('app/private/objetivos/latest.json');

        if ($this->isAbsolutePath($path)) {
            return $path;
        }

        return base_path($path);
    }

    private function isAbsolutePath(string $path): bool
    {
        return str_starts_with($path, '/')
            || str_starts_with($path, '\\')
            || preg_match('/^[A-Za-z]:[\\\\\\/]/', $path) === 1;
    }

    private function isEnabled(): bool
    {
        return (bool) config('tools.enabled', true);
    }
}
