<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_campaign_reply_inbox', function (Blueprint $table) {
            $table->unsignedBigInteger('entry_event_id')->primary();
            $table->string('subject_id', 64);
            $table->string('outbound_message_id', 64);
            $table->index(['subject_id', 'outbound_message_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_campaign_reply_inbox');
    }
};
