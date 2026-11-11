<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_organic_menus', function (Blueprint $table) {
            $table->id();
            $table->uuid('request_id')->unique();
            $table->unsignedBigInteger('entry_event_id')->unique();
            $table->unsignedBigInteger('choice_event_id')->nullable()->unique();
            $table->unsignedBigInteger('canonical_menu_id')->nullable();
            $table->string('subject_id', 64);
            $table->string('cascade_id', 64);
            $table->string('phone_hash', 64)->index();
            $table->text('recipient');
            $table->unsignedBigInteger('chat_id')->nullable();
            $table->unsignedBigInteger('session_id')->nullable();
            $table->json('proof')->nullable();
            $table->string('state', 24)->default('pending');
            $table->string('reason', 80)->nullable();
            $table->string('send_state', 24)->default('pending');
            $table->string('send_reason', 80)->nullable();
            $table->timestamp('send_started_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('confirmed_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->string('choice', 16)->nullable();
            $table->timestamp('choice_received_at')->nullable();
            $table->timestamp('entry_received_at');
            $table->timestamp('expires_at');
            $table->unsignedBigInteger('flow_send_id')->nullable();
            $table->string('transfer_state', 24)->default('pending');
            $table->json('transfer_intent')->nullable();
            $table->boolean('transfer_acknowledged')->default(false);
            $table->text('profile_snapshot')->nullable();
            $table->json('profile_evidence')->nullable();
            $table->string('case_id', 64)->nullable();
            $table->string('deal_id', 64)->nullable();
            $table->string('seller_id', 64)->nullable();
            $table->uuid('lease_token')->nullable();
            $table->timestamp('lease_until')->nullable();
            $table->timestamp('available_at')->nullable();
            $table->timestamp('enqueued_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();
            $table->unique(['subject_id', 'chat_id', 'session_id']);
            $table->index(['state', 'available_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_organic_menus');
    }
};
