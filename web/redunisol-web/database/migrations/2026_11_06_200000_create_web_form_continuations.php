<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('web_form_recipients', function (Blueprint $table) {
            $table->string('phone_hash', 64)->primary();
            $table->timestamps();
        });
        Schema::create('web_form_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('reference_hash', 64)->nullable()->unique();
            $table->string('phone_hash', 64)->nullable()->index();
            $table->string('identity_hash', 64)->nullable();
            $table->string('journey_id', 128)->nullable();
            $table->string('state', 24)->default('pending');
            $table->string('lead_id', 64)->nullable();
            $table->string('contact_id', 64)->nullable();
            $table->string('source', 24)->default('web_server');
            $table->timestamp('received_at');
            $table->timestamp('persisted_at')->nullable();
            $table->timestamp('expires_at')->index();
            $table->timestamps();
        });
        Schema::create('web_form_continuations', function (Blueprint $table) {
            $table->unsignedBigInteger('entry_event_id')->primary();
            $table->uuid('submission_id')->nullable()->index();
            $table->unsignedBigInteger('flow_send_id')->nullable();
            $table->string('state', 24);
            $table->string('reason', 80);
            $table->string('previous_reason', 80)->nullable();
            $table->string('proof_source', 24)->default('unverified');
            $table->string('lead_id', 64)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('web_form_continuations');
        Schema::dropIfExists('web_form_receipts');
        Schema::dropIfExists('web_form_recipients');
    }
};
