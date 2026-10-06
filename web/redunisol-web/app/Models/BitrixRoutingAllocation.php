<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BitrixRoutingAllocation extends Model
{
    protected $fillable = [
        'scope',
        'deal_id',
        'business_date',
        'bucket',
        'online_user_ids',
        'proposed_user_id',
        'assigned_user_id',
        'recurring',
        'compensation_turn',
        'compensated',
    ];

    protected function casts(): array
    {
        return [
            'online_user_ids' => 'array',
            'recurring' => 'boolean',
            'compensation_turn' => 'boolean',
            'compensated' => 'boolean',
        ];
    }
}
