<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_rejected_chat_closures', function (Blueprint $table) {
            $table->unsignedBigInteger('deal_id')->nullable();
        });
    }

    public function down(): void
    {
        // Removing this column would silently turn deal receipts into prospect receipts.
        if (DB::table('edna_rejected_chat_closures')->whereNotNull('deal_id')->exists()) {
            throw new RuntimeException('Cannot remove the deal identity from existing rejection closure receipts.');
        }
        DB::table('edna_intake_cutovers')->where('name', 'rejected-deal-chat-close-v1')->delete();
        Schema::table('edna_rejected_chat_closures', function (Blueprint $table) {
            $table->dropColumn('deal_id');
        });
    }
};
