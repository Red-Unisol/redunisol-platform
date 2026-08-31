<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\View\View;

class HerramientasAccessController extends Controller
{
    public function show(): View
    {
        return view('tools-access', [
            'configurationMissing' => $this->isConfigurationMissing(),
        ]);
    }

    public function login(Request $request)
    {
        if (! config('tools.access.required')) {
            $this->grantAccess($request);

            return redirect()->intended(route('home'));
        }

        if ($this->isConfigurationMissing()) {
            return response()
                ->view('tools-access', ['configurationMissing' => true], 503);
        }

        $validated = $request->validate([
            'password' => ['required', 'string', 'max:200'],
        ]);

        if (! $this->passwordMatches($validated['password'], (string) config('tools.access.password_hash'))) {
            Log::warning('Intento fallido de acceso a herramientas', [
                'ip' => $request->ip(),
                'user_agent' => (string) $request->userAgent(),
            ]);

            return back()
                ->withErrors(['password' => 'Clave incorrecta.'])
                ->onlyInput();
        }

        $this->grantAccess($request);

        return redirect()->intended(route('home'));
    }

    public function logout(Request $request): RedirectResponse
    {
        $request->session()->forget((string) config('tools.access.session_key'));
        $request->session()->regenerateToken();

        return redirect()->route('tools.access.show');
    }

    private function grantAccess(Request $request): void
    {
        $request->session()->regenerate();
        $request->session()->put((string) config('tools.access.session_key'), true);
    }

    private function isConfigurationMissing(): bool
    {
        return config('tools.access.required')
            && trim((string) config('tools.access.password_hash')) === '';
    }

    private function passwordMatches(string $password, string $storedHash): bool
    {
        $storedHash = trim($storedHash);

        if (str_starts_with($storedHash, 'sha256:')) {
            $expected = substr($storedHash, strlen('sha256:'));

            return hash_equals($expected, hash('sha256', $password));
        }

        return password_verify($password, $storedHash);
    }
}
