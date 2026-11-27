<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_organic_menus', function (Blueprint $table) {
            $table->json('paid_entry_routing')->nullable();
            $table->timestamp('reuse_completed_at')->nullable();
            $table->unsignedInteger('request_generation')->default(0);
            $table->dropUnique(['subject_id', 'chat_id', 'session_id']);
            $table->unique(['subject_id', 'chat_id', 'session_id', 'request_generation'], 'edna_org_session_generation_unique');
        });
    }

    public function down(): void
    {
        if (DB::table('edna_organic_menus')->where('request_generation', '>', 0)
            ->orWhereNotNull('paid_entry_routing')->orWhereNotNull('reuse_completed_at')->exists()) {
            throw new RuntimeException('Active paid or renewed intake receipts require this schema.');
        }
        Schema::table('edna_organic_menus', function (Blueprint $table) {
            $table->dropUnique('edna_org_session_generation_unique');
            $table->unique(['subject_id', 'chat_id', 'session_id']);
            $table->dropColumn(['paid_entry_routing', 'request_generation', 'reuse_completed_at']);
        });
    }
};
