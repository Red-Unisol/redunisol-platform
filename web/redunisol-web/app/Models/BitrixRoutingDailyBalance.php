<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BitrixRoutingDailyBalance extends Model
{
    protected $fillable = [
        'scope',
        'business_date',
        'bucket',
        'expected',
        'assigned',
        'non_recurring_count',
        'recent_assignees',
    ];

    protected function casts(): array
    {
        return [
            'expected' => 'array',
            'assigned' => 'array',
            'recent_assignees' => 'array',
        ];
    }
}
