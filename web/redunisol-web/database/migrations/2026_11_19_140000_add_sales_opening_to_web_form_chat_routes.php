<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('web_form_chat_routes', function (Blueprint $table) {
            $table->timestamp('sales_opening_at')->nullable();
            $table->timestamp('retry_expires_at')->nullable()->index();
        });
        Schema::table('web_chat_contexts', function (Blueprint $table) {
            $table->timestamp('sales_opening_at')->nullable();
            $table->timestamp('sales_expires_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('web_form_chat_routes', function (Blueprint $table) {
            $table->dropColumn(['sales_opening_at', 'retry_expires_at']);
        });
        Schema::table('web_chat_contexts', function (Blueprint $table) {
            $table->dropColumn(['sales_opening_at', 'sales_expires_at']);
        });
    }
};
