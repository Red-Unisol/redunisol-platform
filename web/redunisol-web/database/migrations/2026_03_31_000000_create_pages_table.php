<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('pages', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('slug')->unique();
            $table->string('meta_title')->nullable(); // SEO
            $table->text('meta_description')->nullable(); // SEO
            $table->string('keyword')->nullable(); // SEO
            $table->boolean('index')->default(true); // SEO
            $table->json('sections')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('pages');
    }
};
