<?php

use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('edna_intake_cutovers')->insertOrIgnore([
            'name' => 'organic-seller-wait-v1',
            'entry_id_after' => (int) DB::table('edna_incoming_events')->max('id'),
            'starts_at' => CarbonImmutable::now('UTC')->addSecond()->startOfSecond(),
        ]);
    }

    public function down(): void
    {
        DB::table('edna_intake_cutovers')->where('name', 'organic-seller-wait-v1')->delete();
    }
};
