<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_intake_pilots', function (Blueprint $table) {
            // Existing batches retain their original limit when configuration changes.
            $table->unsignedInteger('capacity')->default(10);
        });
    }

    public function down(): void
    {
        Schema::table('edna_intake_pilots', fn (Blueprint $table) => $table->dropColumn('capacity'));
    }
};
