<?php

namespace App\Http\Controllers;

use App\Http\Middleware\AnalisisAccess;
use App\Services\AnalisisInbox;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

class AnalisisController extends Controller
{
    public function index(Request $request)
    {
        if (! config('tools.enabled', true)) {
            return response()->view('disabled', [], 503);
        }

        return response()->view('app', ['payload' => [
            'page' => 'analisis', 'branding' => config('tools.branding'),
            'analisis' => [
                'authenticated' => AnalisisAccess::authenticated($request),
                'configured' => config('analisis.password_hash') !== '' && config('analisis.core_url') !== '',
                'refreshSeconds' => config('analisis.refresh_seconds'),
            ],
        ]])->header('Cache-Control', 'no-store, private');
    }

    public function login(Request $request)
    {
        if (! config('tools.enabled', true) || ! config('analisis.password_hash') || ! config('analisis.core_url')) {
            return response()->json(['message' => 'La bandeja todavía no está disponible.'], 503);
        }
        $data = $request->validate(['password' => ['required', 'string', 'max:200']]);
        $key = 'analisis-login:'.hash('sha256', (string) $request->ip());
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return response()->json(['message' => 'Demasiados intentos. Esperá un minuto y volvé a intentar.'], 429)
                ->header('Retry-After', RateLimiter::availableIn($key));
        }
        if (! password_verify($data['password'], config('analisis.password_hash'))) {
            RateLimiter::hit($key, 60);

            return response()->json(['message' => 'La contraseña no es correcta.'], 422);
        }
        RateLimiter::clear($key);
        $request->session()->regenerate();
        $request->session()->put('analisis_access', hash('sha256', config('analisis.password_hash')));

        return response()->json(['ok' => true])->header('Cache-Control', 'no-store');
    }

    public function logout(Request $request)
    {
        $request->session()->forget('analisis_access');
        $request->session()->regenerate();

        return response()->json(['ok' => true])->header('Cache-Control', 'no-store');
    }

    public function analysts(AnalisisInbox $inbox)
    {
        return $this->sourceResponse(fn () => ['analysts' => $inbox->analysts()]);
    }

    public function snapshot(Request $request, AnalisisInbox $inbox)
    {
        $data = $request->validate(['analyst' => ['required', 'string', 'max:100', 'regex:/^[\pL\pN_.@-]+$/u']]);

        return $this->sourceResponse(fn () => $inbox->snapshot($data['analyst']));
    }

    private function sourceResponse(callable $fetch)
    {
        try {
            return response()->json($fetch());
        } catch (Throwable) {
            return response()->json(['message' => 'No pudimos actualizar desde Vimarx. Conservamos la última lista; volveremos a intentar.'], 503);
        }
    }
}
