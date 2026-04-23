<?php

namespace Database\Seeders;

use App\Models\Page;
use App\Models\Blog;
use Illuminate\Database\Seeder;

class UpdateSeoFieldsSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $this->seedPagesSeo();
        $this->seedBlogsSeo();
    }

    /**
     * Seed SEO fields for pages
     */
    private function seedPagesSeo(): void
    {
        $seoMappings = [
            '/' => [
                'meta_title' => 'Préstamos para Jubilados y Policías | RedúniSol',
                'meta_description' => 'Soluciones de crédito personalizadas para jubilados y policías. Préstamos accesibles con tasas competitivas.',
                'keyword' => 'préstamos jubilados',
                'index' => true,
            ],
            '/prestamos-para-jubilados' => [
                'meta_title' => 'Préstamos para Jubilados | RedúniSol',
                'meta_description' => 'Préstamos especializados para jubilados con tasas preferenciales y trámites rápidos.',
                'keyword' => 'préstamos jubilados',
                'index' => true,
            ],
            '/prestamos-para-policias' => [
                'meta_title' => 'Préstamos para Policías | RedúniSol',
                'meta_description' => 'Líneas de crédito especiales para policías de todas las provincias con beneficios exclusivos.',
                'keyword' => 'préstamos policías',
                'index' => true,
            ],
        ];

        foreach ($seoMappings as $slug => $seoData) {
            $page = Page::where('slug', $slug)->first();
            if ($page) {
                $page->update($seoData);
                $this->command->info("✓ Updated SEO for page: {$slug}");
            }
        }

        // Update remaining pages with default values
        Page::whereNull('meta_title')->each(function (Page $page) {
            $appName = 'RedúniSol';
            $page->update([
                'meta_title' => strlen($page->title) > 50
                    ? substr($page->title, 0, 50) . '... | ' . $appName
                    : $page->title . ' | ' . $appName,
                'meta_description' => 'Soluciones de crédito personalizadas para jubilados y policías',
                'keyword' => strtolower(substr($page->title, 0, 30)),
                'index' => true,
            ]);
            $this->command->info("✓ Updated default SEO for page: {$page->slug}");
        });
    }

    /**
     * Seed SEO fields for blogs
     */
    private function seedBlogsSeo(): void
    {
        Blog::all()->each(function (Blog $blog) {
            // Generate slug from title if not exists
            if (!$blog->slug) {
                $blog->slug = $this->generateSlug($blog->title);
            }

            // Generate meta_title if not exists
            if (!$blog->meta_title) {
                $blog->meta_title = strlen($blog->title) > 55
                    ? substr($blog->title, 0, 55) . '...'
                    : $blog->title;
            }

            // Generate meta_description from content if not exists
            if (!$blog->meta_description) {
                $content = strip_tags($blog->content);
                $blog->meta_description = substr($content, 0, 155) . '...';
            }

            // Generate keyword if not exists
            if (!$blog->keyword) {
                $blog->keyword = strtolower(substr($blog->title, 0, 40));
            }

            // Set index to true by default
            if ($blog->index === null) {
                $blog->index = true;
            }

            $blog->save();
            $this->command->info("✓ Updated SEO for blog: {$blog->title}");
        });
    }

    /**
     * Generate URL-friendly slug from title
     */
    private function generateSlug(string $title): string
    {
        $slug = strtolower($title);
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
        $slug = trim($slug, '-');
        return $slug;
    }
}
