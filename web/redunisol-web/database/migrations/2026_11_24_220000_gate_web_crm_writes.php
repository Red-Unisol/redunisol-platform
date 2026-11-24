<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('web_form_receipts', function (Blueprint $table) {
            $table->string('crm_payload_digest', 64)->nullable();
            $table->timestamp('crm_write_claimed_at')->nullable();
            $table->timestamp('crm_ack_conflict_at')->nullable();
            $table->timestamp('crm_meta_claimed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('web_form_receipts', function (Blueprint $table) {
            $table->dropColumn(['crm_payload_digest', 'crm_write_claimed_at', 'crm_ack_conflict_at', 'crm_meta_claimed_at']);
        });
    }
};
