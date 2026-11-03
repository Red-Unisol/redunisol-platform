<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->boolean('intake_test')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('edna_flow_sends', fn (Blueprint $table) => $table->dropColumn('intake_test'));
    }
};
