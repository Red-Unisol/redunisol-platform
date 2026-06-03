<?php

use App\Http\Controllers\HerramientasController;
use App\Http\Controllers\ContabilidadTransferController;
use App\Http\Controllers\ObjectivesDashboardController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

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
