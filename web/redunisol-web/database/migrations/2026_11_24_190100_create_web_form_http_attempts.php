<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('web_form_http_attempts', function (Blueprint $table) {
            $table->uuid('request_key')->primary();
            $table->uuid('submission_id')->unique();
            $table->char('fingerprint', 64);
            $table->text('continuation')->nullable();
            $table->text('response')->nullable();
            $table->text('snapshot')->nullable();
            $table->uuid('evaluation_token')->nullable();
            $table->timestamp('evaluation_until')->nullable();
            $table->timestamp('expires_at')->index();
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('web_form_http_attempts');
    }
};
