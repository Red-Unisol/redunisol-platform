<?php
namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $email = env('ADMIN_EMAIL', 'admin@solva.ar');
        $password = env('ADMIN_PASSWORD', 'solva-unisol-!)"(');

        if (!$email || !$password) {
            return; // evita romper en entornos sin config
        }

        User::updateOrCreate(
            ['email' => $email],
            [
                'name' => 'Admin',
                'password' => Hash::make($password),
            ]
        );
    }
}
