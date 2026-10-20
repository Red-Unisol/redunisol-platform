<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_assistance_form_receipts', function (Blueprint $table) {
            $table->id();
            $table->string('phone_hash', 64);
            $table->timestamp('submitted_at');
            $table->index(['phone_hash', 'submitted_at']);
        });
        Schema::create('edna_assistance_cases', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('router_result_id')->unique();
            $table->string('scope', 64)->index();
            $table->uuid('request_id')->unique();
            $table->string('subject_id', 64);
            $table->string('cascade_id', 64);
            $table->string('flow_id', 64);
            $table->text('recipient')->nullable();
            $table->string('journey_id', 128)->nullable();
            $table->timestamp('entry_received_at');
            $table->timestamp('due_at')->index();
            $table->string('state', 24)->default('waiting')->index();
            $table->string('reason', 80)->nullable();
            $table->timestamp('send_started_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->unsignedBigInteger('response_event_id')->nullable()->unique();
            $table->timestamp('response_received_at')->nullable();
            $table->text('answer')->nullable();
            $table->text('decision')->nullable();
            $table->string('crm_state', 24)->default('pending');
            $table->string('lead_id', 64)->nullable();
            $table->string('contact_id', 64)->nullable();
            $table->string('link_state', 24)->nullable();
            $table->uuid('link_request_id')->nullable()->unique();
            $table->text('link_text')->nullable();
            $table->timestamp('link_send_started_at')->nullable();
            $table->string('link_outgoing_message_id', 64)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_assistance_cases');
        Schema::dropIfExists('edna_assistance_form_receipts');
    }
};
