<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_customer_profiles', function (Blueprint $table) {
            $table->id();
            $table->string('source_kind', 32);
            $table->string('source_id', 64);
            $table->string('phone_hash', 64)->index();
            $table->string('identity_hash', 64)->index();
            $table->text('answer'); // Encrypted; contains CUIL and optional email.
            $table->timestamp('confirmed_at')->index();
            $table->string('lead_id', 64)->nullable();
            $table->string('contact_id', 64)->nullable();
            $table->timestamps();
            $table->unique(['source_kind', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_customer_profiles');
    }
};
