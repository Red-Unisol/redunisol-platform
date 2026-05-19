<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('redirections', function (Blueprint $table) {
            $table->id();
            $table->string('from')->unique()->comment('Ruta interna de origen, ej: /pagina-vieja');
            $table->string('to')->comment('Destino: ruta interna o URL externa');
            $table->boolean('is_external')->default(false)->comment('Si el destino es una URL externa');
            $table->boolean('is_active')->default(true)->comment('Permite deshabilitar sin borrar');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('redirections');
    }
};
