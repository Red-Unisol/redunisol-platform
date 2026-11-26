<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('web_form_chat_routes', fn (Blueprint $table) => $table->index(['transfer_state', 'state', 'updated_at'], 'web_chat_candidate_window'));
        Schema::table('edna_intake_chat_routes', fn (Blueprint $table) => $table->index(['state', 'updated_at'], 'v3_chat_candidate_window'));
    }

    public function down(): void
    {
        Schema::table('web_form_chat_routes', fn (Blueprint $table) => $table->dropIndex('web_chat_candidate_window'));
        Schema::table('edna_intake_chat_routes', fn (Blueprint $table) => $table->dropIndex('v3_chat_candidate_window'));
    }
};
