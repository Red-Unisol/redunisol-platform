<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_incoming_events', function (Blueprint $table) {
            $table->boolean('out_of_hours_candidate')->default(false);
            $table->timestampTz('out_of_hours_evaluated_at')->nullable();
        });
        Schema::create('edna_out_of_hours_sends', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('event_id')->unique();
            $table->string('scope', 64);
            $table->uuid('request_id')->unique();
            $table->string('subject_id', 64);
            $table->string('cascade_id', 64);
            $table->timestampTz('received_at');
            $table->timestampTz('window_start');
            $table->timestampTz('window_end');
            $table->string('notice_type', 16);
            $table->string('crm_entity')->nullable();
            $table->string('crm_id')->nullable();
            $table->unsignedBigInteger('advisor_id')->nullable();
            $table->text('recipient')->nullable(); // encrypted
            $table->text('message_text')->nullable(); // encrypted; may contain names
            $table->string('state', 24)->default('pending')->index();
            $table->string('reason', 64)->nullable();
            $table->timestampTz('send_started_at')->nullable();
            $table->string('outgoing_message_id', 64)->nullable();
            $table->timestampsTz();
            $table->unique(['scope', 'window_start']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_out_of_hours_sends');
        Schema::table('edna_incoming_events', fn (Blueprint $table) => $table->dropColumn(['out_of_hours_candidate', 'out_of_hours_evaluated_at']));
    }
};
