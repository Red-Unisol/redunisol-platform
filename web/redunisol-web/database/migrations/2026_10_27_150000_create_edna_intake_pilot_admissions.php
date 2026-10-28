<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_intake_pilots', function (Blueprint $table) {
            $table->string('id', 64)->primary();
            $table->string('name', 64);
            $table->string('subject_id', 64);
            $table->string('flow_id', 64);
            $table->unsignedInteger('admitted')->default(0);
            $table->timestamps();
        });
        Schema::create('edna_intake_admissions', function (Blueprint $table) {
            $table->id();
            $table->string('pilot_key', 64);
            $table->string('recipient_hash', 64); // HMAC, never a plaintext phone.
            $table->unsignedInteger('slot');
            $table->timestamps();
            $table->foreign('pilot_key')->references('id')->on('edna_intake_pilots');
            $table->unique(['pilot_key', 'recipient_hash']);
            $table->unique(['pilot_key', 'slot']);
        });
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->unsignedBigInteger('intake_admission_id')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('edna_flow_sends', function (Blueprint $table) {
            $table->dropIndex(['intake_admission_id']);
            $table->dropColumn('intake_admission_id');
        });
        Schema::dropIfExists('edna_intake_admissions');
        Schema::dropIfExists('edna_intake_pilots');
    }
};
