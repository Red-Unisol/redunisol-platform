<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Regulator extends Model
{
    protected $fillable = [
        'name',
        'short_name',
        'logo_path',
        'inaes_mat',
        'bcra_code',
        'cuit',
        'url',
        'is_active',
        'sort_order',
    ];

    protected $casts = [
        'is_active'   => 'boolean',
        'sort_order'  => 'integer',
    ];

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }
}
