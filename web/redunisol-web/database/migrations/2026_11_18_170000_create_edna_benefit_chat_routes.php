<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_benefit_chat_routes', function (Blueprint $table) {
            $table->unsignedBigInteger('entry_event_id')->primary();
            $table->unsignedBigInteger('last_entry_event_id');
            $table->unsignedBigInteger('chat_id');
            $table->unsignedBigInteger('session_id');
            $table->json('proof');
            $table->json('case_snapshot')->nullable();
            $table->unsignedBigInteger('deal_id')->nullable();
            $table->unsignedBigInteger('target_id')->nullable();
            $table->string('state', 24)->default('pending');
            $table->string('reason', 100)->nullable();
            $table->string('transfer_state', 24)->default('pending');
            $table->json('transfer_intent')->nullable();
            $table->boolean('transfer_acknowledged')->default(false);
            $table->json('native_transfer')->nullable();
            $table->timestampTz('received_at');
            $table->timestampTz('expires_at');
            $table->unsignedInteger('attempts')->default(0);
            $table->uuid('lease_token')->nullable();
            $table->timestampTz('lease_until')->nullable();
            $table->timestampTz('available_at')->nullable();
            $table->timestampsTz();
            $table->index(['state', 'available_at']);
            $table->unique(['chat_id', 'session_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_benefit_chat_routes');
    }
};
