<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BitrixRoutingBucket extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['key', 'sellers'];

    protected function casts(): array
    {
        return [
            'sellers' => 'array',
        ];
    }
}
