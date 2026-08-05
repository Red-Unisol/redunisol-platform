<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use RuntimeException;
use SplFileInfo;

class ReportRepository
{
    private const ALLOWED_EXTENSIONS = ['csv', 'pdf', 'xls', 'xlsx'];

    public function root(): string
    {
        return rtrim((string) config('filesystems.reports_path'), DIRECTORY_SEPARATOR);
    }

    public function all(): Collection
    {
        $root = $this->root();

        if (! is_dir($root)) {
            return collect();
        }

        return collect(new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)
        ))
            ->filter(fn (SplFileInfo $file): bool => $file->isFile() && $this->isAllowed($file->getExtension()))
            ->map(function (SplFileInfo $file) use ($root): array {
                $relativePath = Str::replaceFirst($root.DIRECTORY_SEPARATOR, '', $file->getPathname());

                return [
                    'name' => $file->getFilename(),
                    'path' => str_replace(DIRECTORY_SEPARATOR, '/', $relativePath),
                    'group' => str_replace(DIRECTORY_SEPARATOR, ' / ', dirname($relativePath)) === '.'
                        ? 'General'
                        : str_replace(DIRECTORY_SEPARATOR, ' / ', dirname($relativePath)),
                    'size' => $file->getSize(),
                    'modified_at' => $file->getMTime(),
                ];
            })
            ->sortByDesc('modified_at')
            ->values();
    }

    public function resolve(string $relativePath): string
    {
        $root = realpath($this->root());
        $candidate = realpath($this->root().DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relativePath));

        if ($root === false || $candidate === false || ! is_file($candidate)) {
            throw new RuntimeException('El reporte no existe.');
        }

        $rootPrefix = rtrim($root, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR;
        if (! str_starts_with($candidate, $rootPrefix) || ! $this->isAllowed(pathinfo($candidate, PATHINFO_EXTENSION))) {
            throw new RuntimeException('La ruta del reporte no es válida.');
        }

        return $candidate;
    }

    private function isAllowed(string $extension): bool
    {
        return in_array(strtolower($extension), self::ALLOWED_EXTENSIONS, true);
    }
}
