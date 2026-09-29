<?php

namespace App\Http\Controllers;

use App\Http\Middleware\AnalisisAccess;
use App\Services\Padrones;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class PadronesController extends Controller
{
    public function index(Request $request)
    {
        abort_unless(config('tools.enabled', true), 503);

        return response()->view('app', ['payload' => [
            'page' => 'padrones', 'branding' => config('tools.branding'),
            'padrones' => ['authenticated' => AnalisisAccess::authenticated($request), 'configured' => config('analisis.password_hash') !== ''],
        ]])->header('Cache-Control', 'no-store, private');
    }

    public function login(Request $request)
    {
        abort_unless(config('tools.enabled', true) && config('analisis.password_hash'), 503);
        $data = $request->validate(['password' => ['required', 'string', 'max:200']]);
        $key = 'analisis-login:'.hash('sha256', (string) $request->ip());
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return response()->json(['message' => 'Demasiados intentos. Esperá un minuto.'], 429)->header('Retry-After', RateLimiter::availableIn($key));
        }
        if (! password_verify($data['password'], config('analisis.password_hash'))) {
            RateLimiter::hit($key, 60);

            return response()->json(['message' => 'La contraseña no es correcta.'], 422);
        }
        RateLimiter::clear($key);
        $request->session()->regenerate();
        $request->session()->put('analisis_access', hash('sha256', config('analisis.password_hash')));

        return response()->json(['ok' => true])->header('Cache-Control', 'no-store, private');
    }

    public function sources(Padrones $padrones)
    {
        return response()->json(['sources' => $padrones->sources()]);
    }

    public function create(Request $request, Padrones $padrones)
    {
        $data = $request->validate(['name' => 'required|string|max:100', 'description' => 'nullable|string|max:500', 'kind' => 'required|in:padron,bajas']);

        return response()->json(['id' => $padrones->createSource($data)], 201);
    }

    public function upload(Request $request, string $source, Padrones $padrones)
    {
        $data = $request->validate(['file' => ['required', 'file', 'max:'.config('padrones.max_upload_kb')], 'period' => 'required|date_format:Y-m']);

        return response()->json($padrones->upload($source, $request->file('file'), $data['period']), 201);
    }

    public function inspect(string $source, string $version, Padrones $padrones)
    {
        return response()->json($padrones->inspect($source, $version));
    }

    public function prepare(Request $request, string $source, string $version, Padrones $padrones)
    {
        $data = $request->validate([
            'sheet' => 'required|string|max:100', 'header_row' => 'required|integer|min:1|max:10',
            'document_column' => 'required|integer|min:0|max:59', 'columns' => 'required|array|min:1|max:60',
            'columns.*' => 'required|integer|min:0|max:59|distinct',
        ]);

        return response()->json($padrones->prepare($source, $version, $data));
    }

    public function activate(Request $request, string $source, string $version, Padrones $padrones)
    {
        $data = $request->validate(['expected_version' => 'present|nullable|string|max:50', 'acknowledged' => 'required|boolean']);
        $padrones->activate($source, $version, $data['expected_version'], $data['acknowledged']);

        return response()->json(['ok' => true]);
    }

    public function lookup(Request $request, Padrones $padrones)
    {
        $data = $request->validate(['document' => 'required|string|max:30']);

        return response()->json($padrones->lookup($data['document']));
    }
}
