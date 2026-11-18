<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('web_chat_contexts', function (Blueprint $table) {
            $table->id();
            $table->string('subject_id', 64);
            $table->string('phone_hash', 64);
            $table->unsignedBigInteger('anchor_entry_event_id')->unique();
            $table->uuid('submission_id');
            $table->string('state', 24)->default('waiting');
            $table->string('reason', 80)->nullable();
            $table->unsignedBigInteger('chat_id')->nullable();
            $table->unsignedBigInteger('session_id')->nullable();
            $table->json('proof')->nullable();
            $table->timestampTz('expires_at');
            $table->unsignedBigInteger('last_entry_event_id');
            $table->unsignedBigInteger('last_route_entry_event_id')->nullable();
            $table->string('route_state', 24)->nullable();
            $table->string('link_state', 24)->default('pending');
            $table->string('transfer_state', 24)->default('pending');
            $table->json('transfer_intent')->nullable();
            $table->boolean('transfer_acknowledged')->default(false);
            $table->unsignedBigInteger('confirmed_transfer_entry_event_id')->nullable();
            $table->timestampTz('observed_at')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            foreach (['lead_id', 'contact_id', 'deal_id', 'seller_id'] as $field) {
                $table->string($field, 64)->nullable();
            }
            $table->timestampsTz();
            $table->unique(['subject_id', 'phone_hash', 'submission_id']);
            $table->index(['subject_id', 'phone_hash', 'expires_at']);
        });
        Schema::table('web_form_continuations', function (Blueprint $table) {
            $table->unsignedBigInteger('context_id')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('web_form_continuations', function (Blueprint $table) {
            $table->dropColumn('context_id');
        });
        Schema::dropIfExists('web_chat_contexts');
    }
};
