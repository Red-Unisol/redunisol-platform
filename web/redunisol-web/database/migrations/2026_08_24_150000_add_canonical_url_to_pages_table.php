<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const CORDOBA_VARIANT = '/prestamos-para-jubilados/jubilados-cordoba/form-abajo';

    private const CORDOBA_CANONICAL = '/prestamos-para-jubilados/jubilados-cordoba';

    public function up(): void
    {
        Schema::table('pages', function (Blueprint $table) {
            $table->string('canonical_url', 2048)->nullable()->after('index');
        });

        DB::table('pages')
            ->where('slug', self::CORDOBA_VARIANT)
            ->update([
                'index' => false,
                'canonical_url' => self::CORDOBA_CANONICAL,
            ]);
    }

    public function down(): void
    {
        Schema::table('pages', function (Blueprint $table) {
            $table->dropColumn('canonical_url');
        });
    }
};
