<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_intake_bindings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('flow_send_id')->unique();
            $table->uuid('case_id')->unique();
            $table->unsignedBigInteger('entry_event_id');
            $table->string('state', 24)->default('pending');
            $table->string('reason', 64)->nullable();
            $table->string('lead_id', 32)->nullable()->unique();
            $table->text('proof')->nullable(); // Technical IDs only; no phone, message text or identity.
            $table->timestampTz('verified_at')->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_intake_bindings');
    }
};
