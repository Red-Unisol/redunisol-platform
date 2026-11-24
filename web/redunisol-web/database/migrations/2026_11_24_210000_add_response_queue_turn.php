<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bitrix_chat_response_state', function (Blueprint $table) {
            $table->boolean('prefer_recent')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('bitrix_chat_response_state', function (Blueprint $table) {
            $table->dropColumn('prefer_recent');
        });
    }
};
