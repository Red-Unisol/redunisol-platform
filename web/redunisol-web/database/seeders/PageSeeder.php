<?php

namespace Database\Seeders;

use App\Models\Page;
use Illuminate\Database\Seeder;

class PageSeeder extends Seeder
{
    /**
     * Seed the pages table with the existing home.json data.
     */
    public function run(): void
    {
        $homeJson = file_get_contents(resource_path('js/data/pages/home.json'));
        $homeData = json_decode($homeJson, true);

        Page::updateOrCreate(
            ['slug' => '/'],
            [
                'title'    => 'Home',
                'sections' => [
                    [
                        'type' => 'hero',
                        'data' => $homeData['hero'],
                    ],
                    [
                        'type' => 'services',
                        'data' => $homeData['services'],
                    ],
                    [
                        'type' => 'about',
                        'data' => $homeData['about'],
                    ],
                    [
                        'type' => 'faqs',
                        'data' => $homeData['faqs'],
                    ],
                ],
            ]
        );

        $this->command->info('Home page seeded successfully.');
    }
}
