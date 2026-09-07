<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bitrix_routing_buckets', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->json('sellers');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bitrix_routing_buckets');
    }
};
