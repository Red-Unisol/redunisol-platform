<?php

use App\Http\Controllers\HerramientasController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

Route::get('/', [HerramientasController::class, 'index'])->name('home');

Route::post('/api/tools/consulta-renovacion-cruz-del-eje', [HerramientasController::class, 'consultaRenovacionCruzDelEje'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-renovacion-cruz-del-eje');

Route::post('/api/tools/consulta-tope-descuento-caja', [HerramientasController::class, 'consultaTopeDescuentoCaja'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-tope-descuento-caja');

Route::post('/api/tools/consulta-quiebra-credix', [HerramientasController::class, 'consultaQuiebraCredix'])
    ->withoutMiddleware([PreventRequestForgery::class])
    ->name('tools.consulta-quiebra-credix');
