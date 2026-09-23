<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_incoming_events', function (Blueprint $table) {
            $table->id();
            $table->string('subject_id', 64);
            $table->string('message_id', 64);
            $table->text('payload')->nullable(); // Encrypted; never contains HTTP headers.
            $table->string('status', 20)->default('pending')->index();
            $table->string('outcome', 64)->nullable();
            $table->timestamp('delivered_at')->nullable()->index();
            $table->timestamps();
            $table->unique(['subject_id', 'message_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_incoming_events');
    }
};
