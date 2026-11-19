<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_rejected_chat_closures', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('chat_id');
            $table->unsignedBigInteger('session_id');
            $table->unsignedBigInteger('lead_id');
            $table->string('source_type', 40);
            $table->string('source_id', 100);
            $table->timestamp('source_created_at');
            $table->text('proof');
            $table->text('notice')->nullable();
            $table->text('close_intent')->nullable();
            $table->boolean('close_acknowledged')->default(false);
            $table->string('state', 24)->default('pending');
            $table->string('reason', 100)->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->uuid('lease_token')->nullable();
            $table->timestamp('lease_until')->nullable();
            $table->timestamp('available_at')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();
            $table->unique(['chat_id', 'session_id', 'lead_id'], 'edna_rejected_session_lead_unique');
            $table->index(['state', 'available_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_rejected_chat_closures');
    }
};
