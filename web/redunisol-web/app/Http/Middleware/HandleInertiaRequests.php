<?php

namespace App\Http\Middleware;

use App\Models\Regulator;
use App\Models\SiteSetting;
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
                        'settings'   => SiteSetting::allAsArray(),
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
        $appName = config('app.name', 'RedúniSol');
        $currentUrl = $request->url();
        $defaultDescription = 'Soluciones de crédito personalizadas para jubilados y policías';

        return [
            'metaTitle'       => $appName,
            'metaDescription' => $defaultDescription,
            'keyword'         => null,
            'robots'          => 'index, follow',
            'canonical'       => $currentUrl,
        ];
    }
}
