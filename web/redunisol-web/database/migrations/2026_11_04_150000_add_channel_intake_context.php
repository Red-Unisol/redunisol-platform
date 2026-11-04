<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->string('intake_contract', 64)->nullable();
            $table->string('entry_origin', 32)->nullable();
            $table->text('attribution_snapshot')->nullable(); // Encrypted, frozen at entry.
        });
    }

    public function down(): void
    {
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->dropColumn(['intake_contract', 'entry_origin', 'attribution_snapshot']);
        });
    }
};
