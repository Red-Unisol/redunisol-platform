<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_work_queue_keys', function (Blueprint $table) {
            $table->char('key', 64)->primary();
            $table->string('job_class', 191);
            $table->unsignedBigInteger('work_id');
            $table->char('command_sha256', 64);
            // The placeholder exists only inside the same transaction as push.
            // ACK/failure deletes the queue row and releases this hold by FK.
            $table->foreignId('queue_job_id')->nullable()->unique()->constrained('jobs')->cascadeOnDelete();
            $table->timestamp('created_at');
            $table->index(['job_class', 'work_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_work_queue_keys');
    }
};
