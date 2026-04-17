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

    $path = $request->file('recibo')->store('recibos', 'public');

    return response()->json([
        'url' => Storage::disk('public')->url($path),
    ]);
})->name('api.recibos.upload');
