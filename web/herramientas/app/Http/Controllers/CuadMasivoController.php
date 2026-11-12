<?php

namespace App\Http\Controllers;

use App\Http\Middleware\CuadMasivoAccess;
use App\Services\CuadMasivo;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class CuadMasivoController extends Controller
{
    public function index(Request $request, CuadMasivo $cuad)
    {
        abort_unless(config('tools.enabled', true), 503);

        return response()->view('app', ['payload' => ['page' => 'cuad-masivo', 'branding' => config('tools.branding'),
            'cuadMasivo' => ['authenticated' => CuadMasivoAccess::authenticated($request),
                'accessConfigured' => config('cuad_masivo.password_hash') !== '',
                'configured' => $cuad->configured(),
                'linea' => config('cuad_masivo.linea_superior'),
                'maxUploadKb' => config('cuad_masivo.max_upload_kb')]]])
            ->header('Cache-Control', 'no-store, private')->header('X-Robots-Tag', 'noindex, nofollow');
    }

    public function login(Request $request)
    {
        abort_unless(config('tools.enabled', true) && config('cuad_masivo.password_hash'), 503);
        $data = $request->validate(['password' => ['required', 'string', 'max:200']]);
        $key = 'cuad-masivo-login:'.hash('sha256', (string) $request->ip());
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return response()->json(['message' => 'Demasiados intentos. Esperá un minuto y volvé a intentar.'], 429)
                ->header('Retry-After', RateLimiter::availableIn($key));
        }
        if (! password_verify($data['password'], config('cuad_masivo.password_hash'))) {
            RateLimiter::hit($key, 60);

            return response()->json(['message' => 'La contraseña no es correcta.'], 422);
        }
        RateLimiter::clear($key);
        $request->session()->regenerate();
        $request->session()->put('cuad_masivo_access', hash('sha256', config('cuad_masivo.password_hash')));

        return response()->json(['ok' => true])->header('Cache-Control', 'no-store');
    }

    public function history(CuadMasivo $cuad)
    {
        return $this->respond(fn () => $cuad->historial());
    }

    public function start(Request $request, CuadMasivo $cuad)
    {
        $data = $request->validate([
            'modo' => ['required', 'in:excel,linea'],
            'lanzado_por' => ['required', 'string', 'max:80'],
            'archivo' => ['required_if:modo,excel', 'prohibited_unless:modo,excel', 'file',
                'mimes:xlsx', 'max:'.config('cuad_masivo.max_upload_kb')],
        ], ['archivo.mimes' => 'El archivo tiene que ser un Excel .xlsx.',
            'archivo.required_if' => 'Elegí el Excel con los CUIL.',
            'archivo.max' => 'El Excel es demasiado grande.']);

        return $this->respond(fn () => $cuad->iniciar($data['modo'], $request->file('archivo'), trim($data['lanzado_por'])), 202);
    }

    public function status(Request $request, string $corrida, CuadMasivo $cuad)
    {
        $execution = $request->query('execution');

        return $this->respond(fn () => $cuad->estado($corrida, is_string($execution) && $execution !== '' ? $execution : null));
    }

    public function resume(Request $request, string $corrida, CuadMasivo $cuad)
    {
        $data = $request->validate(['lanzado_por' => ['required', 'string', 'max:80']]);

        return $this->respond(fn () => $cuad->retomar($corrida, trim($data['lanzado_por'])), 202);
    }

    public function retry(string $corrida, string $alias, CuadMasivo $cuad)
    {
        return $this->respond(fn () => $cuad->reintentar($corrida, $alias), 202);
    }

    public function download(string $corrida, CuadMasivo $cuad)
    {
        try {
            [$path, $name] = $cuad->archivo($corrida);

            return response()->download($path, $name, ['Content-Type' => 'application/x-ndjson',
                'Cache-Control' => 'no-store, private', 'X-Robots-Tag' => 'noindex, nofollow']);
        } catch (HttpException $exception) {
            throw $exception;
        } catch (Throwable) {
            return response()->json(['message' => 'No pudimos leer el resultado de esta corrida.'], 503);
        }
    }

    private function respond(callable $action, int $status = 200)
    {
        try {
            return response()->json($action(), $status)->header('Cache-Control', 'no-store, private');
        } catch (ValidationException|HttpException|HttpResponseException $exception) {
            throw $exception;
        } catch (Throwable) {
            return response()->json(['message' => 'No pudimos completar la operación con Kestra. Revisá el historial antes de volver a lanzar para no duplicar una corrida.'], 503)
                ->header('Cache-Control', 'no-store, private');
        }
    }
}
