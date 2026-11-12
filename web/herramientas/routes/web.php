<?php

use App\Http\Controllers\AnalisisController;
use App\Http\Controllers\BcraController;
use App\Http\Controllers\ContabilidadTransferController;
use App\Http\Controllers\CuadMasivoController;
use App\Http\Controllers\HerramientasController;
use App\Http\Controllers\ObjectivesDashboardController;
use App\Http\Controllers\PadronesController;
use App\Http\Controllers\PadronesServiceController;
use App\Http\Middleware\PadronesServiceAccess;
use App\Http\Middleware\AnalisisAccess;
use App\Http\Middleware\CuadMasivoAccess;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

Route::get('/analisis', [AnalisisController::class, 'index'])->name('analisis');
Route::get('/bcra', [BcraController::class, 'index'])->name('bcra');
Route::middleware(AnalisisAccess::class)->prefix('/api/bcra')->group(function () {
    Route::get('/catalog', [BcraController::class, 'catalog'])->middleware('throttle:30,1');
    Route::get('/runs', [BcraController::class, 'history']);
    Route::post('/runs', [BcraController::class, 'start'])->middleware('throttle:3,1');
    Route::get('/executions/{execution}', [BcraController::class, 'status'])->middleware('throttle:120,1');
    Route::get('/runs/{run}/download/{artifact}', [BcraController::class, 'download'])->name('bcra.download');
});
Route::get('/cuad-masivo', [CuadMasivoController::class, 'index'])->name('cuad-masivo');
Route::post('/cuad-masivo/login', [CuadMasivoController::class, 'login']);
Route::middleware(CuadMasivoAccess::class)->prefix('/api/cuad-masivo')->group(function () {
    Route::get('/corridas', [CuadMasivoController::class, 'history'])->middleware('throttle:60,1');
    Route::post('/corridas', [CuadMasivoController::class, 'start'])->middleware('throttle:3,1');
    Route::get('/corridas/{corrida}', [CuadMasivoController::class, 'status'])->middleware('throttle:120,1');
    Route::post('/corridas/{corrida}/retomar', [CuadMasivoController::class, 'resume'])->middleware('throttle:3,1');
    Route::post('/corridas/{corrida}/reintentar/{alias}', [CuadMasivoController::class, 'retry'])->middleware('throttle:10,1');
    Route::get('/corridas/{corrida}/descargar', [CuadMasivoController::class, 'download'])->name('cuad-masivo.download');
});
Route::get('/padrones', [PadronesController::class, 'index'])->name('padrones');
Route::post('/api/internal/padrones/lookup', PadronesServiceController::class)
    ->middleware([PadronesServiceAccess::class, 'throttle:120,1'])
    ->withoutMiddleware([PreventRequestForgery::class]);
Route::post('/padrones/login', [PadronesController::class, 'login']);
Route::middleware(AnalisisAccess::class)->prefix('/api/padrones')->group(function () {
    Route::get('/sources', [PadronesController::class, 'sources']);
    Route::post('/sources', [PadronesController::class, 'create']);
    Route::post('/lookup', [PadronesController::class, 'lookup'])->middleware('throttle:120,1');
    Route::post('/sources/{source}/versions', [PadronesController::class, 'upload'])->middleware('throttle:15,1');
    Route::get('/sources/{source}/versions/{version}', [PadronesController::class, 'inspect']);
    Route::post('/sources/{source}/versions/{version}/prepare', [PadronesController::class, 'prepare'])->middleware('throttle:15,1');
    Route::post('/sources/{source}/versions/{version}/activate', [PadronesController::class, 'activate']);
});
Route::post('/analisis/login', [AnalisisController::class, 'login']);
Route::middleware(AnalisisAccess::class)->group(function () {
    Route::post('/analisis/logout', [AnalisisController::class, 'logout']);
    Route::get('/api/analisis/analysts', [AnalisisController::class, 'analysts']);
    Route::get('/api/analisis/snapshot', [AnalisisController::class, 'snapshot']);
});

Route::get('/', [HerramientasController::class, 'index'])->name('home');
Route::get('/credixsa', [HerramientasController::class, 'credixsa'])->name('credixsa');

$contabilidadPath = trim((string) config('tools.contabilidad.path'), '/');

Route::get($contabilidadPath, [ContabilidadTransferController::class, 'index'])
    ->name('contabilidad-transfer.index');

Route::get("/api/{$contabilidadPath}/outputs", [ContabilidadTransferController::class, 'status'])
    ->name('contabilidad-transfer.status');

Route::get("/api/{$contabilidadPath}/outputs/{date}/download/{type}", [ContabilidadTransferController::class, 'download'])
    ->name('contabilidad-transfer.download');

$objectivesPath = trim((string) config('tools.objectives.path'), '/');

Route::get($objectivesPath, [ObjectivesDashboardController::class, 'index'])
    ->name('objectives.index');

Route::get("/api/{$objectivesPath}/snapshot", [ObjectivesDashboardController::class, 'snapshot'])
    ->name('objectives.snapshot');

Route::post('/api/tools/consulta-renovacion-cruz-del-eje', [HerramientasController::class, 'consultaRenovacionCruzDelEje'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-renovacion-cruz-del-eje');

Route::post('/api/tools/consulta-tope-descuento-caja', [HerramientasController::class, 'consultaTopeDescuentoCaja'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-tope-descuento-caja');

Route::post('/api/tools/consulta-quiebra-credix', [HerramientasController::class, 'consultaQuiebraCredix'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-quiebra-credix');

Route::post('/api/tools/consulta-empleador', [HerramientasController::class, 'consultaEmpleador'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-empleador');

Route::post('/api/tools/consulta-cuad', [HerramientasController::class, 'consultaCuad'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-cuad');
