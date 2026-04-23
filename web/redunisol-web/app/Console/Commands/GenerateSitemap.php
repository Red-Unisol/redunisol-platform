<?php

namespace App\Console\Commands;

use App\Models\Page;
use App\Models\Blog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class GenerateSitemap extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'sitemap:generate';

    /**
     * The description of the console command.
     *
     * @var string
     */
    protected $description = 'Generate sitemap.xml for SEO';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $this->info('Generating sitemap...');

        $sitemap = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $sitemap .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

        // Add Pages
        $pages = Page::where('index', true)->get();
        $pageCount = 0;
        foreach ($pages as $page) {
            // Skip finalizar.php
            if ($page->slug === '/finalizar.php') {
                continue;
            }

            $url = rtrim(config('app.url'), '/') . $page->slug;
            $sitemap .= $this->generateUrlEntry($url, $page->updated_at, 'weekly', '0.8');
            $pageCount++;
        }

        // Add Blogs
        $blogs = Blog::where('index', true)->get();
        $blogCount = 0;
        foreach ($blogs as $blog) {
            if ($blog->slug) {
                $url = rtrim(config('app.url'), '/') . '/blog/' . $blog->slug;
                $sitemap .= $this->generateUrlEntry($url, $blog->updated_at, 'monthly', '0.6');
                $blogCount++;
            }
        }

        // Add static routes
        $staticRoutes = [
            ['url' => config('app.url'), 'priority' => '1.0', 'changefreq' => 'daily'],
            ['url' => config('app.url') . '/dashboard', 'priority' => '0.5', 'changefreq' => 'weekly'],
        ];

        foreach ($staticRoutes as $route) {
            $sitemap .= $this->generateUrlEntry($route['url'], now(), $route['changefreq'], $route['priority']);
        }

        $sitemap .= '</urlset>';

        // Save sitemap to public directory
        $path = public_path('sitemap.xml');
        File::put($path, $sitemap);

        $this->info("✓ Sitemap generated successfully!");
        $this->info("  - Pages: {$pageCount}");
        $this->info("  - Blogs: {$blogCount}");
        $this->info("  - Static routes: " . count($staticRoutes));
        $this->info("  - Location: {$path}");

        return self::SUCCESS;
    }

    /**
     * Generate a single URL entry for sitemap
     */
    private function generateUrlEntry(string $url, $lastmod, string $changefreq, string $priority): string
    {
        $entry = '  <url>' . "\n";
        $entry .= '    <loc>' . htmlspecialchars($url) . '</loc>' . "\n";
        $entry .= '    <lastmod>' . $lastmod->format('Y-m-d') . '</lastmod>' . "\n";
        $entry .= '    <changefreq>' . $changefreq . '</changefreq>' . "\n";
        $entry .= '    <priority>' . $priority . '</priority>' . "\n";
        $entry .= '  </url>' . "\n";

        return $entry;
    }
}
