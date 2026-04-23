<?php

return [
    /*
    |--------------------------------------------------------------------------
    | SEO Configuration
    |--------------------------------------------------------------------------
    |
    | This configuration controls all SEO-related settings for the platform.
    |
    */

    'app_name' => env('APP_NAME', 'RedúniSol'),

    /*
    |--------------------------------------------------------------------------
    | Meta Tags Configuration
    |--------------------------------------------------------------------------
    */

    'meta' => [
        // Meta title character limits
        'title' => [
            'min' => 30,
            'max' => 60,
            'recommended' => 55,
        ],

        // Meta description character limits
        'description' => [
            'min' => 120,
            'max' => 160,
            'recommended' => 155,
        ],

        // Default values
        'default_description' => 'Soluciones de crédito personalizadas para jubilados y policías',
        'default_keywords' => 'préstamos, jubilados, policías, crédito, RedúniSol',
    ],

    /*
    |--------------------------------------------------------------------------
    | Robots Configuration
    |--------------------------------------------------------------------------
    */

    'robots' => [
        'enabled' => true,

        // Paths to block from indexing
        'disallow' => [
            '/admin/',
            '/api/',
            '/storage/',
            '/finalizar.php',
            '/*.php$',
        ],

        // Crawl delay in seconds
        'crawl_delay' => 1,

        // User agents to target
        'user_agents' => [
            '*', // All user agents
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Sitemap Configuration
    |--------------------------------------------------------------------------
    */

    'sitemap' => [
        'enabled' => true,
        'cache_ttl' => 3600, // 1 hour in seconds

        // Priority settings for different content types
        'priorities' => [
            'pages' => [
                'priority' => 0.8,
                'changefreq' => 'weekly',
            ],
            'blogs' => [
                'priority' => 0.6,
                'changefreq' => 'monthly',
            ],
            'static' => [
                'priority' => 1.0,
                'changefreq' => 'daily',
            ],
        ],

        // Exclude these slugs from sitemap
        'exclude' => [
            '/finalizar.php',
        ],

        // Static routes to include
        'static_routes' => [
            [
                'url' => '/',
                'priority' => 1.0,
                'changefreq' => 'daily',
            ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Structured Data (JSON-LD)
    |--------------------------------------------------------------------------
    */

    'structured_data' => [
        'enabled' => true,

        'organization' => [
            'name' => env('APP_NAME', 'RedúniSol'),
            'url' => env('APP_URL', 'https://redunisol.com'),
            'logo' => env('APP_URL') . '/logo.png',
            'description' => 'Soluciones de crédito personalizadas para jubilados y policías',
            'contact_type' => 'Customer Service',
            'telephone' => env('BUSINESS_PHONE', ''),
            'email' => env('BUSINESS_EMAIL', ''),
        ],

        'social_profiles' => [
            'facebook' => env('FACEBOOK_URL', ''),
            'twitter' => env('TWITTER_URL', ''),
            'linkedin' => env('LINKEDIN_URL', ''),
            'instagram' => env('INSTAGRAM_URL', ''),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Open Graph & Social Media
    |--------------------------------------------------------------------------
    */

    'social' => [
        // Default OG image
        'og_image' => env('APP_URL') . '/og-image.png',

        // Twitter handle
        'twitter_handle' => env('TWITTER_HANDLE', '@redunisol'),

        // Default card type
        'default_card_type' => 'summary_large_image',
    ],

    /*
    |--------------------------------------------------------------------------
    | Canonical URLs
    |--------------------------------------------------------------------------
    */

    'canonical' => [
        'enabled' => true,
        'auto_generate' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Indexing Rules
    |--------------------------------------------------------------------------
    */

    'indexing' => [
        // Routes to never index (noindex by default)
        'never_index' => [
            'admin',
            'api',
            'login',
            'register',
            'password-reset',
            'settings',
        ],

        // Query parameters to exclude from canonical URL
        'exclude_query_params' => [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'fbclid',
            'gclid',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | SEO Validation
    |--------------------------------------------------------------------------
    */

    'validation' => [
        // Enforce field requirements
        'enforce_meta_title' => true,
        'enforce_meta_description' => true,
        'enforce_keyword' => true,

        // Warning thresholds
        'warnings' => [
            'title_too_short' => 30,
            'title_too_long' => 60,
            'description_too_short' => 120,
            'description_too_long' => 160,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Performance & Caching
    |--------------------------------------------------------------------------
    */

    'cache' => [
        'enabled' => true,
        'ttl' => 86400, // 24 hours

        // Cache keys
        'keys' => [
            'sitemap' => 'seo:sitemap',
            'robots' => 'seo:robots',
            'schema' => 'seo:schema',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Internationalization
    |--------------------------------------------------------------------------
    */

    'i18n' => [
        'enabled' => false,
        'default_locale' => 'es',
        'supported_locales' => ['es', 'en'],
    ],
];
