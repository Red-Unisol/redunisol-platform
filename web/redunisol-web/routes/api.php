<?php

use App\Http\Controllers\PdfSearchController;
use Illuminate\Support\Facades\Route;

Route::post('/pdf/search', PdfSearchController::class)->name('api.pdf.search');
