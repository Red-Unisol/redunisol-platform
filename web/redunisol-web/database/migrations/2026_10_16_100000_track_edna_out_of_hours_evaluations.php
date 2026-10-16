<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_incoming_events', function (Blueprint $table) {
            $table->uuid('out_of_hours_evaluation_id')->nullable();
            $table->timestampTz('out_of_hours_evaluation_failed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('edna_incoming_events', fn (Blueprint $table) => $table->dropColumn([
            'out_of_hours_evaluation_id', 'out_of_hours_evaluation_failed_at',
        ]));
    }
};
