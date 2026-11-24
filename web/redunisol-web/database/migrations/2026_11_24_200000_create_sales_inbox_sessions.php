<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_inbox_cursors', function (Blueprint $table) {
            $table->unsignedSmallInteger('line_id')->primary();
            $table->timestamp('starts_at');
            $table->timestamp('scanned_until');
        });
        Schema::create('sales_rejection_watches', function (Blueprint $table) {
            $table->unsignedBigInteger('session_id');
            $table->unsignedBigInteger('lead_id');
            $table->primary(['session_id', 'lead_id']);
            $table->json('candidate');
            $table->timestamp('next_check_at')->index();
            $table->timestamp('expires_at')->index();
        });
        Schema::create('sales_inbox_sessions', function (Blueprint $table) {
            $table->unsignedBigInteger('session_id')->primary();
            $table->unsignedBigInteger('chat_id');
            $table->string('channel', 40);
            $table->timestamp('opened_at');
            $table->string('state', 32);
            $table->string('reason', 80)->nullable();
            $table->timestamp('available_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->json('campaign')->nullable();
            $table->json('intent')->nullable();
            $table->boolean('acknowledged')->default(false);
            $table->string('native_event_sha256', 64)->nullable();
            $table->timestamps();
            $table->index(['state', 'available_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_rejection_watches');
        Schema::dropIfExists('sales_inbox_sessions');
        Schema::dropIfExists('sales_inbox_cursors');
    }
};
