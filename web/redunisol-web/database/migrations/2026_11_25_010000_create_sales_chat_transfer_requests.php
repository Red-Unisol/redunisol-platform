<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_chat_transfer_requests', function (Blueprint $table) {
            $table->id();
            $table->string('scope', 80);
            $table->unsignedBigInteger('chat_id');
            $table->unsignedBigInteger('session_id');
            $table->unsignedBigInteger('deal_id');
            $table->unsignedBigInteger('lead_id');
            $table->unsignedBigInteger('contact_id')->nullable();
            $table->string('stage_id', 100);
            $table->unsignedBigInteger('target_id');
            $table->string('state', 24)->default('pending');
            $table->string('reason', 80)->default('received');
            $table->unsignedInteger('attempts')->default(0);
            $table->unsignedInteger('unverified_checks')->default(0);
            $table->timestampTz('first_unverified_at')->nullable();
            $table->timestampTz('last_unverified_at')->nullable();
            $table->timestampTz('available_at')->nullable();
            $table->timestampTz('deadline_at');
            $table->timestampTz('intent_at')->nullable();
            $table->unsignedBigInteger('owner_before')->nullable();
            $table->boolean('acknowledged')->default(false);
            $table->string('native_event_sha256', 64)->nullable()->unique();
            $table->timestampsTz();
            $table->unique(['scope', 'chat_id', 'session_id'], 'sales_delivery_session');
            $table->index(['scope', 'available_at', 'id'], 'sales_delivery_due');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_chat_transfer_requests');
    }
};
