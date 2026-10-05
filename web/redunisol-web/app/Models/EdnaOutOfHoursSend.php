<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EdnaOutOfHoursSend extends Model
{
    protected $guarded = [];

    protected $hidden = ['recipient', 'message_text'];

    protected function casts(): array
    {
        return ['recipient' => 'encrypted', 'message_text' => 'encrypted',
            'received_at' => 'immutable_datetime', 'window_start' => 'immutable_datetime',
            'window_end' => 'immutable_datetime', 'send_started_at' => 'immutable_datetime'];
    }
}
