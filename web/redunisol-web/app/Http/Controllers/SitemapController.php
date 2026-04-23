<?php

namespace App\Http\Controllers;

use App\Models\Page;
use App\Models\Blog;
use Illuminate\Http\Response;

class SitemapController extends Controller
{
    /**
     * Generate dynamic sitemap.xml
     */
    public function index(): Response
    {
        $sitemap = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $sitemap .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

        // Add Pages
        $pages = Page::where('index', true)->get();
        foreach ($pages as $page) {
            // Skip finalizar.php
            if ($page->slug === '/finalizar.php') {
                continue;
            }

            $url = rtrim(config('app.url'), '/') . $page->slug;
            $sitemap .= $this->generateUrlEntry($url, $page->updated_at, 'weekly', '0.8');
        }

        // Add Blogs
        $blogs = Blog::where('index', true)->get();
        foreach ($blogs as $blog) {
            if ($blog->slug) {
                $url = rtrim(config('app.url'), '/') . '/blog/' . $blog->slug;
                $sitemap .= $this->generateUrlEntry($url, $blog->updated_at, 'monthly', '0.6');
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

        return response($sitemap, 200)
            ->header('Content-Type', 'application/xml; charset=utf-8')
            ->header('Cache-Control', 'public, max-age=3600');
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
