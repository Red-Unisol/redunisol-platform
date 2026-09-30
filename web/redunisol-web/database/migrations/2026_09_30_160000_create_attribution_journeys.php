<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attribution_journeys', function (Blueprint $table) {
            $table->string('id', 24)->primary();
            $table->text('snapshot'); // Encrypted acquisition data, never sent to the browser.
            $table->string('recipient_hash', 64)->nullable();
            $table->string('subject_id')->nullable();
            $table->timestamp('bound_at')->nullable();
            $table->timestamp('expires_at')->index();
            $table->timestamps();
        });
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->string('journey_id', 24)->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('edna_flow_sends', fn (Blueprint $table) => $table->dropColumn('journey_id'));
        Schema::dropIfExists('attribution_journeys');
    }
};
