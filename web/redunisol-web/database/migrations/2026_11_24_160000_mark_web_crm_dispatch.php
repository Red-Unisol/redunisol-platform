<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_intake_bindings', function (Blueprint $table) {
            $table->unsignedBigInteger('native_session_id')->nullable()->index();
        });
        Schema::table('web_form_receipts', function (Blueprint $table) {
            $table->timestamp('crm_dispatched_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('edna_intake_bindings', function (Blueprint $table) {
            $table->dropIndex(['native_session_id']);
            $table->dropColumn('native_session_id');
        });
        Schema::table('web_form_receipts', function (Blueprint $table) {
            $table->dropColumn('crm_dispatched_at');
        });
    }
};
