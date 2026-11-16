<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bitrix_routing_sellers', function (Blueprint $table) {
            $table->unsignedBigInteger('bitrix_user_id')->primary();
            $table->string('name');
            $table->string('email')->nullable();
            $table->boolean('enabled')->default(false);
            $table->timestamps();
        });
        Schema::create('bitrix_routing_seller_changes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('before_ids');
            $table->json('after_ids');
            $table->json('paused_buckets');
            $table->timestamp('created_at');
        });

        // One-time snapshot. Subsequent deployments must not reset admin choices.
        $sellers = [
            68579 => 'Daniel Carrera',
            10451 => 'Patricia Contendi',
            29 => 'Susana Contenti',
            90231 => 'Soledad Rojo Moyano',
            71159 => 'Natalia Rojo Moyano',
            113457 => 'Claudia Algarbe',
            113455 => 'Daniela Arias',
            116561 => 'Julieta Aguilera',
            110059 => 'Agustín Villagra',
            53121 => 'Gloria Fernandez',
            128399 => 'Stefania Salguero (128399)',
            58913 => 'Ludmila Gallardo',
            127337 => 'Renato Rodriguez Barros',
            125693 => 'Saira Cardoso',
            128877 => 'Patricia Barboza',
        ];
        foreach ($sellers as $id => $name) {
            DB::table('bitrix_routing_sellers')->insert([
                'bitrix_user_id' => $id, 'name' => $name, 'enabled' => true,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('bitrix_routing_seller_changes');
        Schema::dropIfExists('bitrix_routing_sellers');
    }
};
