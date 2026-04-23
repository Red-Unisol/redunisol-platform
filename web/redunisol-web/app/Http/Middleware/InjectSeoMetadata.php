<?php

namespace App\Http\Middleware;

use App\Models\Page;
use App\Models\Blog;
use App\Services\SeoService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

class InjectSeoMetadata
{
    protected $seoService;

    public function __construct()
    {
        $this->seoService = new SeoService();
    }

    public function handle(Request $request, Closure $next)
    {
        $currentPath = $request->path();

        // Skip SEO injection for certain routes
        if ($this->shouldSkipSeoInjection($currentPath)) {
            return $next($request);
        }

        // Determine SEO data based on current page
        $seoData = $this->getSeoDataForCurrentPage($currentPath);

        // Inject into Inertia shared props
        if ($seoData) {
            \Inertia\Inertia::share('seo', $seoData);
        }

        return $next($request);
    }

    /**
     * Check if SEO injection should be skipped for this route
     */
    private function shouldSkipSeoInjection(string $path): bool
    {
        $skipPaths = [
            'dashboard',
            'test',
            'health',
            'settings',
            'admin',
            'filament',
            'login',
            'register',
            'forgot-password',
            'api',
        ];

        foreach ($skipPaths as $skipPath) {
            if (str_starts_with($path, $skipPath)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get SEO data for the current page
     */
    private function getSeoDataForCurrentPage(string $currentPath): ?array
    {
        // Handle landing pages and nested pages
        $slug = '/' . ltrim($currentPath, '/');

        // Try to find a Page model for this slug
        $page = Page::where('slug', $slug)->first();
        if ($page) {
            return [
                'metaTitle' => $page->meta_title ?: $this->seoService->generateMetaTitle($page),
                'metaDescription' => $page->meta_description ?: $this->seoService->generateMetaDescription($page),
                'keyword' => $page->keyword,
                'robots' => $this->seoService->getRobotsTag($page),
                'canonical' => $this->seoService->getCanonicalUrl($page),
                'structuredData' => json_encode($this->seoService->getStructuredData($page)),
            ];
        }

        // Try to find a Blog model for /blog/{slug}
        if (str_starts_with($currentPath, 'blog/')) {
            $blogSlug = str_replace('blog/', '', $currentPath);
            $blog = Blog::where('slug', $blogSlug)->first();

            if ($blog) {
                return [
                    'metaTitle' => $blog->meta_title ?: $this->seoService->generateMetaTitle($blog),
                    'metaDescription' => $blog->meta_description ?: $this->seoService->generateMetaDescription($blog),
                    'keyword' => $blog->keyword,
                    'robots' => $this->seoService->getRobotsTag($blog),
                    'canonical' => $this->seoService->getCanonicalUrl($blog),
                    'structuredData' => json_encode($this->seoService->getStructuredData($blog)),
                ];
            }
        }

        return null;
    }
}
