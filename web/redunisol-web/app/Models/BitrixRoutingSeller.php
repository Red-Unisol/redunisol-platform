<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BitrixRoutingSeller extends Model
{
    protected $primaryKey = 'bitrix_user_id';

    public $incrementing = false;

    protected $fillable = ['bitrix_user_id', 'name', 'email', 'enabled'];

    protected function casts(): array
    {
        return ['enabled' => 'boolean'];
    }

    public function label(): string
    {
        return $this->email ? $this->name.' — '.$this->email : $this->name;
    }
}
