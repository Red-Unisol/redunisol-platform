<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Redirection extends Model
{
    protected $fillable = [
        'from',
        'to',
        'is_external',
        'is_active',
    ];

    protected $casts = [
        'is_external' => 'boolean',
        'is_active'   => 'boolean',
    ];
}
