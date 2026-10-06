<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_router_results', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('flow_send_id')->unique();
            $table->unsignedBigInteger('response_event_id')->unique();
            $table->string('province', 32);
            $table->string('situation', 32);
            $table->string('segment', 64);
            $table->text('landing_url');
            $table->text('message_text');
            $table->timestamp('response_received_at');
            $table->uuid('request_id')->unique();
            $table->string('state', 24)->default('pending')->index();
            $table->string('reason', 64)->nullable();
            $table->timestamp('send_started_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->string('crm_state', 24)->default('pending')->index();
            $table->string('crm_reason', 64)->nullable();
            $table->string('crm_entity', 16)->nullable();
            $table->string('crm_id', 64)->nullable();
            $table->timestamp('crm_synced_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_router_results');
    }
};
