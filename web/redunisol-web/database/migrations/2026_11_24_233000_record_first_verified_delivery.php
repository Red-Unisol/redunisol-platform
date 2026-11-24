<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edna_customer_delivery_observations', function (Blueprint $table) {
            $table->string('subject_id', 64);
            $table->string('outgoing_message_id', 64);
            $table->timestamp('first_observed_at')->index();
            $table->primary(['subject_id', 'outgoing_message_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edna_customer_delivery_observations');
    }
};
