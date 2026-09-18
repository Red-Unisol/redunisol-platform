<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_router_contacts', function (Blueprint $table) {
            $table->string('scope', 64)->primary(); // HMAC; never a plaintext phone.
            $table->timestamps();
        });
        Schema::create('edna_flow_sends', function (Blueprint $table) {
            $table->id();
            $table->uuid('request_id')->unique();
            $table->unsignedBigInteger('entry_event_id')->unique();
            $table->string('scope', 64)->index();
            $table->string('subject_id', 64);
            $table->string('cascade_id', 64);
            $table->string('flow_id', 64);
            $table->text('recipient')->nullable(); // Encrypted; cleared by the retention command.
            $table->string('state', 24)->default('pending')->index();
            $table->string('reason', 64)->nullable();
            $table->timestamp('entry_received_at');
            $table->timestamp('send_started_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->unsignedBigInteger('response_event_id')->nullable()->unique();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->unique(['subject_id', 'outgoing_message_id']);
        });
        Schema::table('edna_incoming_events', function (Blueprint $table) {
            $table->string('router_action', 64)->nullable();
            $table->unsignedBigInteger('flow_send_id')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('edna_incoming_events', function (Blueprint $table) {
            $table->dropColumn(['router_action', 'flow_send_id']);
        });
        Schema::dropIfExists('edna_flow_sends');
        Schema::dropIfExists('edna_router_contacts');
    }
};
