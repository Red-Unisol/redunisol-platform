<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_campaign_unsubscribe_requests', function (Blueprint $table) {
            $table->unsignedBigInteger('entry_event_id')->primary();
            $table->unsignedBigInteger('route_entry_event_id')->index();
            $table->unsignedBigInteger('native_message_id');
            $table->unsignedBigInteger('outbound_message_id');
            $table->unsignedBigInteger('matcher_id');
            $table->timestampTz('requested_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_campaign_unsubscribe_requests');
    }
};
