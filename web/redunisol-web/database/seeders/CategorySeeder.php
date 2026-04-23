<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;

class CategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            ['name' => 'Catamarca',                                             'slug' => 'catamarca'],
            ['name' => 'Cómo funcionan',                                        'slug' => 'como-funcionan'],
            ['name' => 'Cómo se pagan',                                         'slug' => 'como-se-pagan'],
            ['name' => 'Comprar televisor',                                     'slug' => 'comprar-televisor'],
            ['name' => 'Cooperativas',                                          'slug' => 'cooperativas'],
            ['name' => 'Córdoba',                                               'slug' => 'cordoba'],
            ['name' => 'Créditos hipotecarios',                                 'slug' => 'creditos-hipotecarios'],
            ['name' => 'Descuento por recibo',                                  'slug' => 'descuento-por-recibo'],
            ['name' => 'Docentes Neuquén',                                      'slug' => 'docentes-neuquen-2'],
            ['name' => 'Edad máxima',                                           'slug' => 'edad-maxima'],
            ['name' => 'Educación financiera',                                  'slug' => 'educacion-financiera'],
            ['name' => 'Empleados públicos',                                    'slug' => 'empleados-publicos'],
            ['name' => 'Empleados públicos de Catamarca',                       'slug' => 'empleados-publicos-de-catamarca'],
            ['name' => 'Empleados Públicos de Córdoba',                         'slug' => 'empleados-publicos-de-cordoba'],
            ['name' => 'Empleados públicos provinciales',                       'slug' => 'empleados-publicos-provinciales'],
            ['name' => 'Financiación de electrodomésticos',                     'slug' => 'financiacion-de-electrodomesticos'],
            ['name' => 'Garantía de préstamos',                                 'slug' => 'garantia-de-prestamos'],
            ['name' => 'Historial Crediticio',                                  'slug' => 'historial-crediticio'],
            ['name' => 'Intereses',                                             'slug' => 'intereses'],
            ['name' => 'Jubilados',                                             'slug' => 'jubilados'],
            ['name' => 'Jubilados y pensionados de Córdoba',                    'slug' => 'jubilados-y-pensionados-de-cordoba'],
            ['name' => 'Multas camineras',                                      'slug' => 'multas-camineras'],
            ['name' => 'Mutuales',                                              'slug' => 'mutuales'],
            ['name' => 'Mutuales en Argentina',                                 'slug' => 'mutuales-en-argentina'],
            ['name' => 'Pagar deudas',                                          'slug' => 'pagar-deudas'],
            ['name' => 'Policía caminera',                                      'slug' => 'policia-caminera'],
            ['name' => 'Policía de Catamarca',                                  'slug' => 'policia-de-catamarca'],
            ['name' => 'Policía de Córdoba',                                    'slug' => 'policia-de-cordoba'],
            ['name' => 'Policías',                                              'slug' => 'policias'],
            ['name' => 'Préstamos',                                             'slug' => 'prestamos'],
            ['name' => 'Préstamos de 1 millón',                                 'slug' => 'prestamos-de-1-millon'],
            ['name' => 'Préstamos de 100 mil',                                  'slug' => 'prestamos-de-100-mil'],
            ['name' => 'Préstamos de 2 millones',                               'slug' => 'prestamos-de-2-millones'],
            ['name' => 'Préstamos de 400 mil',                                  'slug' => 'prestamos-de-400-mil'],
            ['name' => 'Préstamos de 50 mil',                                   'slug' => 'prestamos-de-50-mil'],
            ['name' => 'Préstamos Empleados UNC',                               'slug' => 'prestamos-empleados-unc'],
            ['name' => 'Préstamos para ampliar vivienda',                       'slug' => 'prestamos-para-ampliar-vivienda'],
            ['name' => 'Préstamos para comprar una moto nueva o usada',         'slug' => 'prestamos-para-comprar-una-moto-nueva-o-usada'],
            ['name' => 'Préstamos para docentes',                               'slug' => 'prestamos-para-docentes'],
            ['name' => 'Préstamos para docentes de Catamarca',                  'slug' => 'prestamos-para-docentes-de-catamarca'],
            ['name' => 'Préstamos para docentes de Córdoba',                    'slug' => 'prestamos-para-docentes-de-cordoba'],
            ['name' => 'Préstamos para jubilados',                              'slug' => 'prestamos-para-jubilados'],
            ['name' => 'Préstamos para jubilados Santa Fe',                     'slug' => 'prestamos-para-jubilados-santa-fe'],
            ['name' => 'Préstamos para pagar estudios médicos',                 'slug' => 'prestamos-para-pagar-estudios-medicos'],
            ['name' => 'Préstamos para pagar multas',                           'slug' => 'prestamos-para-pagar-multas'],
            ['name' => 'Préstamos para policías',                               'slug' => 'prestamos-para-policias'],
            ['name' => 'Préstamos para viviendas',                              'slug' => 'prestamos-para-viviendas'],
            ['name' => 'Préstamos policía Santa Fé',                            'slug' => 'prestamos-policia-santa-fe'],
            ['name' => 'Préstamos sin garantes',                                'slug' => 'prestamos-sin-garantes'],
            ['name' => 'Red Unisol',                                            'slug' => 'red-unisol'],
            ['name' => 'Sin categoría',                                         'slug' => 'sin-categoria'],
            ['name' => 'Televisor en cuotas',                                   'slug' => 'televisor-en-cuotas'],
        ];

        foreach ($categories as $cat) {
            Category::updateOrCreate(
                ['slug' => $cat['slug']],
                ['name' => $cat['name']]
            );
        }
    }
}
