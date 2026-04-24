<?php

namespace Database\Seeders;

use App\Models\Regulator;
use Illuminate\Database\Seeder;

class RegulatorSeeder extends Seeder
{
    public function run(): void
    {
        $regulators = [
            [
                'name'       => 'Asociación Mutual Celesol de Servicios Integrales y Educativos',
                'short_name' => 'Celesol',
                'logo_path'  => null,
                'inaes_mat'  => '768',
                'bcra_code'  => '55281',
                'cuit'       => '33-70870702-9',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 1,
            ],
            [
                'name'       => 'Asociación Mutual Fiat Concord',
                'short_name' => 'Fiat Concord',
                'logo_path'  => null,
                'inaes_mat'  => '233',
                'bcra_code'  => '55277',
                'cuit'       => '30-62415628-1',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 2,
            ],
        ];

        foreach ($regulators as $data) {
            Regulator::updateOrCreate(
                ['short_name' => $data['short_name']],
                $data
            );
        }
    }
}
