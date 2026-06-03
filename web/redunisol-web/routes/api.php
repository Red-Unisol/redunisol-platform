<?php

use App\Http\Controllers\FormSubmissionController;
use App\Http\Controllers\PdfSearchController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

Route::post('/pdf/search', PdfSearchController::class)->name('api.pdf.search');
Route::post('/form-submissions', FormSubmissionController::class)->name('api.form-submissions.store');

Route::post('/recibos/upload', function (Request $request) {
    $request->validate([
        'recibo' => 'required|file|mimes:jpg,jpeg,png,gif,pdf|max:10240',
    ]);

    $diskName = (string) config('filesystems.recibos_disk', 'public');
    $disk = Storage::disk($diskName);
    $path = $request->file('recibo')->store('recibos', $diskName);
    $expiresAt = now()->addMinutes((int) config('filesystems.recibos_temporary_url_minutes', 10080));

    try {
        $url = $disk->temporaryUrl($path, $expiresAt);
    } catch (Throwable) {
        $url = $disk->url($path);
    }

    return response()->json([
        'url' => $url,
    ]);
})->name('api.recibos.upload');
