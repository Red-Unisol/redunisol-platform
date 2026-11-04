<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->uuid('transport_request_id')->nullable()->unique();
        });
        Schema::create('edna_flow_send_attempts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('flow_send_id');
            $table->unsignedInteger('attempt_no');
            $table->uuid('transport_request_id')->unique();
            $table->uuid('operation_id')->nullable()->unique();
            $table->string('expected_lead_id', 64)->nullable();
            $table->string('state', 24);
            $table->string('reason', 80)->nullable();
            $table->json('original_snapshot')->nullable(); // Technical IDs, states and dates only.
            $table->string('provider_status', 24)->nullable();
            $table->string('verified_failed_message_id', 64)->nullable();
            $table->timestamp('send_started_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->unsignedBigInteger('response_event_id')->nullable();
            $table->timestamps();
            $table->unique(['flow_send_id', 'attempt_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_flow_send_attempts');
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->dropUnique(['transport_request_id']);
            $table->dropColumn('transport_request_id');
        });
    }
};
