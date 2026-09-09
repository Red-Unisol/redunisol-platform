<?php

namespace Database\Seeders;

use App\Models\Regulator;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Throwable;

// Las entidades de convenio que se muestran en el finalizar, con los datos tal
// como estan cargados en produccion. El objetivo es que dev muestre lo mismo:
// hasta ahora tenia solo dos de las cinco, asi que un prestamo de amejuca,
// mudon o ameppc aparecia sin la tarjeta del convenio.
//
// La busqueda es por short_name contra el codigo de mutual de la linea, asi que
// ese campo tiene que coincidir con lo que hay en Vimarx en
// [Terminos y condiciones]. No lo cambies sin mirar eso.
class RegulatorSeeder extends Seeder
{
    // Los logos son archivos subidos, no estan en el repositorio y sus nombres
    // son ULIDs. Se bajan de la web publica para no tener que copiarlos a mano
    // entre ambientes.
    private const ORIGEN_LOGOS = 'https://redunisol.com.ar/storage/';

    public function run(): void
    {
        $regulators = [
            [
                'name'       => 'Asociación Mutual Celesol de Servicios Integrales y Educativos',
                'short_name' => 'Celesol',
                'logo_path'  => 'regulators/01KYQQPNV5NF7PR7RHKQ3TXNJT.png',
                'inaes_mat'  => '768',
                'bcra_code'  => '55281',
                'cuit'       => '33-70870702-9',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 1,
            ],
            [
                'name'       => 'Asociación Mutual Fiat Concord',
                'short_name' => 'fiat_celesol',
                'logo_path'  => 'regulators/01KYWMHEVR4YV61TR1VZX5NEFP.png',
                'inaes_mat'  => '233',
                'bcra_code'  => '55277',
                'cuit'       => '30-62415628-1',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 2,
            ],
            [
                'name'       => 'Asociacion Mutual Amejuca',
                'short_name' => 'amejuca',
                'logo_path'  => 'regulators/01KZ6Q35GYY9ZVJ81BE7D90AVW.jpg',
                'inaes_mat'  => '68',
                'bcra_code'  => null,
                'cuit'       => '30695171745',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 3,
            ],
            [
                'name'       => 'MUTUAL DE DOCENTES DEL NEUQUÉN (MU.DO.N.)',
                'short_name' => 'mudon',
                'logo_path'  => 'regulators/01KZCHTQH4SNKD3PEBQXXH3XXR.jpg',
                'inaes_mat'  => '33',
                'bcra_code'  => null,
                'cuit'       => '30-62556738-2',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 4,
            ],
            [
                'name'       => 'ASOCIACIÓN MUTUAL DE EMPLEADOS DE POLICÍA DE LA PROVINCIA DE CÓRDOBA',
                'short_name' => 'ameppc',
                'logo_path'  => 'regulators/01KZCHWTV8WN0NEKTT58K116VR.png',
                'inaes_mat'  => '159',
                'bcra_code'  => null,
                'cuit'       => '30-52960163-4',
                'url'        => null,
                'is_active'  => true,
                'sort_order' => 5,
            ],
        ];

        foreach ($regulators as $data) {
            $data['logo_path'] = $this->asegurarLogo($data['logo_path']);

            Regulator::updateOrCreate(
                ['short_name' => $data['short_name']],
                $data
            );
        }
    }

    // Devuelve el path si el archivo esta disponible, o null si no se pudo
    // traer. Guardar un path cuyo archivo no existe deja la tarjeta con la
    // imagen rota, que se ve peor que sin logo.
    private function asegurarLogo(?string $logoPath): ?string
    {
        if ($logoPath === null) {
            return null;
        }

        $disk = Storage::disk('public');

        if ($disk->exists($logoPath)) {
            return $logoPath;
        }

        try {
            $response = Http::timeout(20)->get(self::ORIGEN_LOGOS.$logoPath);
        } catch (Throwable) {
            $this->command?->warn("No se pudo descargar el logo {$logoPath}; queda sin logo.");

            return null;
        }

        if (!$response->successful()) {
            $this->command?->warn("No se pudo descargar el logo {$logoPath}; queda sin logo.");

            return null;
        }

        $disk->put($logoPath, $response->body());

        return $logoPath;
    }
}
