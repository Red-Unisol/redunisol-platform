<?php

namespace App\Http\Controllers;

use App\Support\ReportCatalog;
use App\Support\ReportRepository;
use Filament\Facades\Filament;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class AdminReportDownloadController extends Controller
{
    public function __invoke(string $path, ReportRepository $reports): BinaryFileResponse
    {
        abort_unless(auth()->user()?->canAccessPanel(Filament::getPanel('admin')), 403);

        try {
            $file = $reports->resolve($path);
        } catch (\RuntimeException) {
            abort(404);
        }

        $name = app(ReportCatalog::class)->downloadName(['path' => $path, 'modified_at' => filemtime($file)]);

        return response()->download($file, $name, [
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
