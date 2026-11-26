<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_intake_requests', function (Blueprint $table): void {
            $table->uuid('web_submission_id')->nullable()->index();
            $table->json('web_prequalification')->nullable();
        });
    }

    public function down(): void
    {
        if (\Illuminate\Support\Facades\DB::table('edna_intake_requests')->whereNotNull('web_submission_id')->exists()) {
            throw new RuntimeException('Cannot discard captured declaration revisions.');
        }
        Schema::table('edna_intake_requests', function (Blueprint $table): void {
            $table->dropIndex(['web_submission_id']);
            $table->dropColumn(['web_submission_id', 'web_prequalification']);
        });
    }
};
