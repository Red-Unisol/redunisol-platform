<?php

namespace Database\Seeders;

use App\Models\Page;
use Illuminate\Database\Seeder;

class PageSeeder extends Seeder
{
    /**
     * Map of slug => [title, json_file]
     * json_file is relative to resources/js/data/pages/
     */
    private array $pages = [
        '/'  => ['Home', 'home.json'],
        '/prestamos-para-policias'                              => ['Préstamos para Policías Provinciales',          'prestamos-para-policias.json'],
        '/prestamos-para-empleados-publicos'                    => ['Préstamos para Empleados Públicos Provinciales', 'prestamos-para-empleados-publicos.json'],
        '/prestamos-para-empleados-publicos/emp-pub-cordoba'    => ['Préstamos para Empleados Públicos de Córdoba',   'prestamos-para-empleados-publicos-cordoba.json'],
        '/prestamos-para-empleados-publicos/emp-pub-catamarca'  => ['Préstamos para Empleados Públicos de Catamarca', 'prestamos-para-empleados-publicos-catamarca.json'],
        '/prestamos-para-jubilados'                             => ['Préstamos para Jubilados Provinciales',          'prestamos-para-jubilados.json'],
        '/prestamos-para-jubilados/jubilados-cordoba'           => ['Préstamos para Jubilados de Córdoba',            'prestamos-para-jubilados-cordoba.json'],
    ];

    public function run(): void
    {
        $basePath = resource_path('js/data/pages');

        foreach ($this->pages as $slug => [$title, $file]) {
            $path = "{$basePath}/{$file}";

            if (! file_exists($path)) {
                $this->command->warn("Skipping {$slug}: file not found ({$file})");
                continue;
            }

            $sections = json_decode(file_get_contents($path), true);

            // home.json tiene estructura legacy {hero:{}, services:{}, ...}
            // Las páginas nuevas ya usan el formato Filament [{type, data}, ...]
            if (isset($sections['hero'])) {
                $sections = [
                    ['type' => 'hero',     'data' => $sections['hero']],
                    ['type' => 'services', 'data' => $sections['services']],
                    ['type' => 'about',    'data' => $sections['about']],
                    ['type' => 'faqs',     'data' => $sections['faqs']],
                ];
            }

            Page::updateOrCreate(
                ['slug' => $slug],
                ['title' => $title, 'sections' => $sections]
            );

            $this->command->info("✓ {$slug}");
        }
    }
}
