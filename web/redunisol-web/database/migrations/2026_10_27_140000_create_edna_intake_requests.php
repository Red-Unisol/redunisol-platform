<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_intake_requests', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('flow_send_id')->unique();
            $table->unsignedBigInteger('response_event_id')->unique();
            $table->text('answer')->nullable(); // Encrypted; never expose CUIL/email in status/logs.
            $table->timestamp('received_at');
            $table->string('state', 24)->default('pending')->index();
            $table->string('reason', 80)->nullable();
            $table->string('lead_id', 64)->nullable();
            $table->string('contact_id', 64)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_intake_requests');
    }
};
