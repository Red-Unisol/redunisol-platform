<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('web_form_chat_routes', function (Blueprint $table) {
            $table->unsignedBigInteger('entry_event_id')->primary();
            $table->uuid('submission_id')->nullable()->index();
            $table->string('phone_hash', 64)->nullable()->index();
            $table->string('state', 24)->default('pending');
            $table->string('reason', 80)->nullable();
            $table->json('proof')->nullable();
            $table->string('deal_id', 64)->nullable();
            $table->string('seller_id', 64)->nullable();
            $table->string('link_state', 24)->default('pending');
            $table->string('transfer_state', 24)->default('pending');
            $table->uuid('lease_token')->nullable();
            $table->timestamp('lease_until')->nullable();
            $table->timestamp('available_at')->nullable();
            $table->timestamp('enqueued_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();
            $table->index(['state', 'available_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('web_form_chat_routes');
    }
};
