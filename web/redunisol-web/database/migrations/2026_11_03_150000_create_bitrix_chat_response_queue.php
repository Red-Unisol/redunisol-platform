<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bitrix_chat_response_queue', function (Blueprint $table) {
            $table->string('key', 80)->primary();
            $table->text('payload');
            $table->unsignedBigInteger('version')->default(1);
            $table->unsignedBigInteger('processed_version')->default(0);
            $table->unsignedBigInteger('event_id')->default(0);
            $table->string('source', 100)->nullable();
            $table->unsignedBigInteger('cursor')->default(0);
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('available_at')->index();
            $table->string('outcome', 40)->nullable();
            $table->timestamps();
        });
        Schema::create('bitrix_chat_response_state', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->uuid('lease')->nullable();
            $table->timestamp('lease_until')->nullable();
            $table->string('job_key', 80)->nullable();
            $table->unsignedBigInteger('job_version')->nullable();
            $table->unsignedBigInteger('cursor')->default(0);
            $table->timestamp('next_fallback_at')->nullable();
            $table->json('last_result')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bitrix_chat_response_state');
        Schema::dropIfExists('bitrix_chat_response_queue');
    }
};
