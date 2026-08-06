<?php

namespace App\Http\Controllers;

use App\Support\ReportRepository;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class AdminReportDownloadController extends Controller
{
    public function __invoke(string $path, ReportRepository $reports): BinaryFileResponse
    {
        try {
            $file = $reports->resolve($path);
        } catch (\RuntimeException) {
            abort(404);
        }

        return response()->download($file, basename($file), [
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
