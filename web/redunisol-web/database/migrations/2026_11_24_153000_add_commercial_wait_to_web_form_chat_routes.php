<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('web_form_chat_routes', function (Blueprint $table) {
            $table->timestamp('commercial_wait_until')->nullable();
            $table->index(['deal_id', 'state'], 'web_route_waiting_deal');
        });
    }

    public function down(): void
    {
        Schema::table('web_form_chat_routes', function (Blueprint $table) {
            $table->dropIndex('web_route_waiting_deal');
            $table->dropColumn('commercial_wait_until');
        });
    }
};
