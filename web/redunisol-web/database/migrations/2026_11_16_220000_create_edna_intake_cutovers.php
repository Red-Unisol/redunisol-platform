<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_intake_cutovers', function (Blueprint $table) {
            $table->string('name')->primary();
            $table->unsignedBigInteger('entry_id_after');
            $table->timestampTz('starts_at');
        });
        Schema::create('edna_intake_chat_routes', function (Blueprint $table) {
            $table->unsignedBigInteger('request_id')->primary();
            $table->string('state', 24)->default('pending');
            $table->string('reason')->nullable();
            $table->text('proof');
            $table->text('assigned_case');
            $table->text('transfer_intent')->nullable();
            $table->boolean('transfer_acknowledged')->default(false);
            $table->timestampTz('lease_until')->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_intake_chat_routes');
        Schema::dropIfExists('edna_intake_cutovers');
    }
};
