<?php

namespace App\Http\Controllers;

use App\Http\Middleware\AnalisisAccess;
use App\Services\BcraPresentations;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class BcraController extends Controller
{
    public function index(Request $request, BcraPresentations $bcra)
    {
        abort_unless(config('tools.enabled', true), 503);

        return response()->view('app', ['payload' => ['page' => 'bcra', 'branding' => config('tools.branding'),
            'bcra' => ['authenticated' => AnalisisAccess::authenticated($request),
                'accessConfigured' => config('analisis.password_hash') !== '' && config('analisis.core_url') !== '',
                'configured' => $bcra->configured(),
                'latestClosedMonth' => now('America/Argentina/Buenos_Aires')->startOfMonth()->subMonth()->format('Y-m')]]])
            ->header('Cache-Control', 'no-store, private')->header('X-Robots-Tag', 'noindex, nofollow');
    }

    public function catalog(BcraPresentations $bcra)
    {
        return $this->respond(fn () => $bcra->catalog());
    }

    public function history(BcraPresentations $bcra)
    {
        return $this->respond(fn () => ['runs' => $bcra->history()]);
    }

    public function start(Request $request, BcraPresentations $bcra)
    {
        $data = $request->validate([
            'period' => ['required', 'regex:/^20\d{2}-(0[1-9]|1[0-2])$/'],
            'declared_by' => ['required', 'string', 'max:80'],
            'presentation_type' => ['required', 'in:NORMAL,RECTIFICATIVA'],
            'rate' => ['required', 'string', 'regex:/^\d{1,3},\d{2}$/'],
            'granted_without_real_guarantee' => ['required', 'boolean'],
            'selected_line_ids' => ['required', 'array', 'min:1', 'max:10000'],
            'selected_line_ids.*' => ['required', 'string', 'distinct', 'regex:/^[1-9]\d{0,9}$/'],
            'normal_until_66_superior_ids' => ['present', 'array', 'max:1000'],
            'normal_until_66_superior_ids.*' => ['required', 'string', 'distinct', 'regex:/^[1-9]\d{0,9}$/'],
            'excluded_cuits' => ['present', 'array', 'max:1000'],
            'excluded_cuits.*.value' => ['required', 'string', 'distinct', 'regex:/^\d{11}$/'],
            'excluded_cuits.*.reason' => ['required', 'string', 'max:300'],
            'excluded_accounts' => ['present', 'array', 'max:1000'],
            'excluded_accounts.*.value' => ['required', 'string', 'distinct', 'max:50', 'regex:/^[A-Za-z0-9 ._\/\-]+$/'],
            'excluded_accounts.*.reason' => ['required', 'string', 'max:300'],
        ]);

        return $this->respond(fn () => $bcra->start($data), 202);
    }

    public function status(string $execution, BcraPresentations $bcra)
    {
        return $this->respond(fn () => $bcra->status($execution));
    }

    public function download(string $run, string $artifact, BcraPresentations $bcra)
    {
        try {
            [$path, $name] = $bcra->artifact($run, $artifact);

            return response()->download($path, $name, ['Cache-Control' => 'no-store, private', 'X-Robots-Tag' => 'noindex, nofollow']);
        } catch (HttpException $exception) {
            throw $exception;
        } catch (Throwable) {
            return response()->json(['message' => 'No pudimos verificar el archivo. No se descargó una copia incompleta.'], 503);
        }
    }

    private function respond(callable $action, int $status = 200)
    {
        try {
            return response()->json($action(), $status)->header('Cache-Control', 'no-store, private');
        } catch (ValidationException|HttpException|HttpResponseException $exception) {
            throw $exception;
        } catch (Throwable) {
            return response()->json(['message' => 'No pudimos completar la consulta. Revisá el historial antes de volver a generar para evitar una corrida duplicada.'], 503)
                ->header('Cache-Control', 'no-store, private');
        }
    }
}
