<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blogs', function (Blueprint $table) {
            $table->unsignedBigInteger('author_entity_id')
                ->nullable()
                ->after('author_id');

            $table->foreign('author_entity_id')
                ->references('id')
                ->on('authors')
                ->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::table('blogs', function (Blueprint $table) {
            $table->dropForeign(['author_entity_id']);
            $table->dropColumn('author_entity_id');
        });
    }
};
