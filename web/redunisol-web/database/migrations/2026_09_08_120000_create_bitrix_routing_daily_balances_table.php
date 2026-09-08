<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bitrix_routing_daily_balances', function (Blueprint $table) {
            $table->id();
            $table->string('scope');
            $table->date('business_date');
            $table->string('bucket');
            $table->json('expected')->default('{}');
            $table->json('assigned')->default('{}');
            $table->unsignedInteger('non_recurring_count')->default(0);
            $table->json('recent_assignees')->default('[]');
            $table->timestamps();

            $table->unique(['scope', 'business_date', 'bucket']);
        });

        Schema::create('bitrix_routing_allocations', function (Blueprint $table) {
            $table->id();
            $table->string('scope');
            $table->unsignedBigInteger('deal_id');
            $table->date('business_date');
            $table->string('bucket');
            $table->json('online_user_ids');
            $table->unsignedBigInteger('proposed_user_id');
            $table->unsignedBigInteger('assigned_user_id');
            $table->boolean('recurring');
            $table->boolean('compensation_turn');
            $table->boolean('compensated');
            $table->timestamps();

            $table->unique(['scope', 'deal_id']);
            $table->index(['scope', 'business_date', 'bucket']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bitrix_routing_allocations');
        Schema::dropIfExists('bitrix_routing_daily_balances');
    }
};
