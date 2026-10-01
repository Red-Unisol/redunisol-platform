<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_form_links', function (Blueprint $table) {
            $table->string('scope', 64)->primary();
            $table->string('subject_id', 64);
            $table->text('recipient'); // encrypted, never queued or logged
            $table->unsignedBigInteger('entry_event_id');
            $table->unsignedBigInteger('last_event_id');
            $table->timestampTz('entry_received_at');
            $table->timestampTz('last_received_at');
            $table->string('journey_id', 24)->nullable();
            $table->string('crm_entity')->nullable();
            $table->string('crm_id')->nullable();
            $table->string('crm_state')->default('pending');
            $table->string('crm_reason')->nullable();
            $table->index(['crm_entity', 'crm_id', 'subject_id']);
            $table->timestampsTz();
        });
        Schema::create('edna_form_link_sends', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('entry_event_id')->unique();
            $table->string('scope', 64);
            $table->uuid('request_id')->unique();
            $table->string('subject_id', 64);
            $table->string('cascade_id', 64);
            $table->text('recipient')->nullable();
            $table->string('journey_id', 24)->nullable();
            $table->string('state')->default('pending');
            $table->string('crm_entity');
            $table->string('crm_id');
            $table->text('content')->nullable();
            $table->string('reason')->nullable();
            $table->timestampTz('send_started_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_form_link_sends');
        Schema::dropIfExists('edna_form_links');
    }
};
