<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_sales_chat_handoffs', function (Blueprint $table) {
            $table->unsignedBigInteger('chat_id');
            $table->unsignedBigInteger('session_id');
            $table->primary(['chat_id', 'session_id']);
            $table->unsignedBigInteger('entry_event_id')->unique();
            $table->unsignedBigInteger('native_message_id');
            $table->unsignedBigInteger('target_id');
            $table->string('family', 16);
            $table->timestamp('created_at');
            $table->timestamp('post_started_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_sales_chat_handoffs');
    }
};
