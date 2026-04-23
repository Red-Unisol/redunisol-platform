<?php

use App\Models\Page;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;


Route::get('/health', function () {
    $status = [];

    // Check Database Connection
    try {
        DB::connection()->getPdo();
        DB::select('SELECT 1');
        $status['database'] = 'OK';
    } catch (\Exception $e) {
        $status['database'] = 'Error';
    }

    // Check Redis Connection
    try {
        Cache::store('redis')->put('health_check', 'OK', 10);
        $value = Cache::store('redis')->get('health_check');
        $status['redis'] = ($value === 'OK') ? 'OK' : 'Error';
    } catch (\Exception $e) {
        $status['redis'] = 'Error';
    }

    // Check Storage Access
    try {
        $testFile = 'health_check.txt';
        Storage::put($testFile, 'OK');
        $content = Storage::get($testFile);
        Storage::delete($testFile);
        $status['storage'] = ($content === 'OK') ? 'OK' : 'Error';
    } catch (\Exception $e) {
        $status['storage'] = 'Error';
    }

    $isHealthy = collect($status)->every(fn($value) => $value === 'OK');

    return response()->json($status, $isHealthy ? 200 : 503);
});

Route::get('/sitemap.xml', [\App\Http\Controllers\SitemapController::class, 'index'])->name('sitemap');

Route::get('/robots.txt', [\App\Http\Controllers\RobotsController::class, 'show'])->name('robots');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', function () {
        return Inertia::render('dashboard');
    })->name('dashboard');
});

Route::get('/test', function () {
    return Inertia::render('test');
})->name('test');

require __DIR__.'/settings.php';

// ──────────────────────────────────────────────────────────────
//   /                                           → slug /
//   /prestamos-para-policias                    → slug /prestamos-para-policias
//   /prestamos-para-policias/policia-rio-negro  → slug /prestamos-para-policias/policia-rio-negro
// ──────────────────────────────────────────────────────────────

Route::get('/{slug?}', function ($slug = null) {
    $slug = $slug ? '/' . ltrim($slug, '/') : '/';

    $page = Page::where('slug', $slug)->firstOrFail();

    return Inertia::render('welcome', [
        'landingSlug' => $slug,
        'sections' => $page->sections,
        'title'    => $page->title,
        'meta_title' => $page->meta_title,
        'meta_description' => $page->meta_description,
        'keyword' => $page->keyword,
        'index' => $page->index,
    ]);
})->where('slug', '.*');
