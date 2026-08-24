<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Page extends Model
{
    protected $fillable = [
        'title',
        'slug',
        'meta_title',
        'meta_description',
        'keyword',
        'index',
        'canonical_url',
        'sections',
    ];

    protected $casts = [
        'index' => 'boolean',
        'sections' => 'array',
    ];
}
