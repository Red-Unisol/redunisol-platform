<?php

namespace App\Services;

class ManagedRedirects
{
    public function targetFor(string $host, string $path): ?string
    {
        // Decode once so accented names and spaces in retired PDFs match URLs.
        $path = '/'.trim(rawurldecode($path), '/');
        $host = strtolower($host);
        if ($host === 'www.redunisol.com.ar') {
            $host = 'redunisol.com.ar';
        }

        // Read the whole map: dots in a hostname are literal keys, not config paths.
        $rules = config('legacy_redirects', [])[$host] ?? [];
        if (isset($rules[$path])) {
            return $rules[$path];
        }

        foreach ($rules as $source => $target) {
            if (! str_ends_with($source, '/*')) {
                continue;
            }
            $prefix = substr($source, 0, -2);
            if ($path === $prefix || str_starts_with($path, $prefix.'/')) {
                return $target;
            }
        }

        return config('redirects', [])[$path] ?? null;
    }
}
