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
        'sections',
    ];

    protected $casts = [
        'sections' => 'array',
    ];
}
