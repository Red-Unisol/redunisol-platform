<?php

use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edna_organic_menus', function (Blueprint $table) {
            $table->json('campaign_prompt')->nullable();
        });
        DB::table('edna_intake_cutovers')->insertOrIgnore([
            'name' => 'edna-campaign-templates-v1',
            'entry_id_after' => (int) DB::table('edna_incoming_events')->max('id'),
            'starts_at' => CarbonImmutable::now('UTC')->addSecond()->startOfSecond(),
        ]);
    }

    public function down(): void
    {
        DB::table('edna_intake_cutovers')->where('name', 'edna-campaign-templates-v1')->delete();
        Schema::table('edna_organic_menus', function (Blueprint $table) {
            $table->dropColumn('campaign_prompt');
        });
    }
};
