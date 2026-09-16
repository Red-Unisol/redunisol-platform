<?php

namespace App\Http\Middleware;

use App\Models\Author;
use App\Models\Blog;
use App\Models\Category;
use App\Models\Page;
use App\Models\Regulator;
use App\Models\SiteSetting;
use App\Services\SeoService;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $seo = $this->getSeoData($request);

        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
            'seo' => $seo,
            'siteData' => function () {
                try {
                    return [
                        'regulators' => Regulator::active()->orderBy('sort_order')->get()->toArray(),
                        'settings' => SiteSetting::allAsArray(),
                    ];
                } catch (\Throwable $e) {
                    return ['regulators' => [], 'settings' => []];
                }
            },
        ];
    }

    /**
     * Get SEO data for the current page.
     */
    protected function getSeoData(Request $request): array
    {
        $appName = config('app.name', 'Red Unisol');
        $currentUrl = $request->url();
        $defaultDescription = config('seo.meta.default_description', 'Soluciones de crédito personalizadas para jubilados y policías');
        $seoService = app(SeoService::class);
        $currentPath = $request->path();
        $pageSlug = $currentPath === '/' ? '/' : '/'.ltrim($currentPath, '/');
        $model = Page::where('slug', $pageSlug)->first();

        if (! $model && str_starts_with($currentPath, 'blog/')) {
            $model = Blog::where('slug', substr($currentPath, strlen('blog/')))->first();
        }

        if ($model) {
            return [
                'metaTitle' => $seoService->formatTitle($model->meta_title ?: $seoService->generateMetaTitle($model)),
                'metaDescription' => $model->meta_description ?: $seoService->generateMetaDescription($model),
                'keyword' => $model->keyword,
                'robots' => $seoService->getRobotsTag($model),
                'canonical' => $seoService->getCanonicalUrl($model),
                'ogImage' => $model instanceof Blog ? ($model->image_url ?: asset('logo.jpeg')) : asset('logo.jpeg'),
                'ogType' => $model instanceof Blog ? 'article' : 'website',
                'structuredData' => json_encode($seoService->getStructuredData($model)),
            ];
        }

        $title = $appName;
        if ($request->routeIs('blog.index')) {
            $title = 'Blog';
            $defaultDescription = 'Consejos, novedades y guías sobre préstamos personales para empleados públicos, jubilados y más.';
        } elseif ($request->routeIs('blog.category')) {
            $category = Category::where('slug', $request->route('slug'))->first();
            $title = $category ? 'Artículos sobre '.$category->name : 'Blog';
        } elseif ($request->routeIs('author.show')) {
            $author = Author::active()->where('slug', $request->route('slug'))->first();
            $title = $author ? 'Artículos de '.$author->name : 'Blog';
        }

        return [
            'metaTitle' => $seoService->formatTitle($title),
            'metaDescription' => $defaultDescription,
            'keyword' => null,
            'robots' => 'index, follow',
            'canonical' => $currentUrl,
            'ogImage' => asset('logo.jpeg'),
            'ogType' => 'website',
        ];
    }
}
