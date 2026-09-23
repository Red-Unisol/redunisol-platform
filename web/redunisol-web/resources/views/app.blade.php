<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" @class(['dark' => ($appearance ?? 'system') == 'dark'])>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        @if(config('services.gtm.id'))
        @php
            $gtmDebugParams = (config('services.gtm.auth') && config('services.gtm.preview'))
                ? '&gtm_auth='.config('services.gtm.auth').'&gtm_preview='.config('services.gtm.preview').'&gtm_cookies_win=x'
                : '';
        @endphp
        <script>
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});
        var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
        j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl+'{{ $gtmDebugParams }}';
        f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','{{ config('services.gtm.id') }}');
        </script>
        @endif
        @if(config('services.meta.pixel_id'))
        <script>
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', @json(config('services.meta.pixel_id')));
        fbq('track', 'PageView');
        </script>
        @endif
        {{-- Inline script to detect system dark mode preference and apply it immediately --}}
        <script>
            (function() {
                const appearance = '{{ $appearance ?? "system" }}';

                if (appearance === 'system') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

                    if (prefersDark) {
                        document.documentElement.classList.add('dark');
                    }
                }
            })();
        </script>

        {{-- Inline style to set the HTML background color based on our theme in app.css --}}
        <style>
            html {
                background-color: oklch(1 0 0);
            }

            html.dark {
                background-color: oklch(0.145 0 0);
            }
        </style>

        @inertiaHead
        {{-- Inertia 2: use page-specific fallbacks only when SSR did not provide the head. --}}
        @if (!($__inertiaSsrResponse ?? null))
        @php
            $seo = data_get($page, 'props.seo', []);
            $seoTitle = data_get($seo, 'metaTitle', config('app.name', 'Red Unisol'));
            $seoDescription = data_get($seo, 'metaDescription', config('seo.meta.default_description'));
            $seoImage = data_get($seo, 'ogImage', asset('logo.jpeg'));
            $seoCanonical = data_get($seo, 'canonical', request()->url());
        @endphp
        <title inertia>{{ $seoTitle }}</title>
        <meta inertia="description" name="description" content="{{ $seoDescription }}">
        @if (data_get($seo, 'keyword'))
        <meta inertia="keywords" name="keywords" content="{{ $seo['keyword'] }}">
        @endif
        <meta inertia="robots" name="robots" content="{{ data_get($seo, 'robots', 'index, follow') }}">
        <link inertia="canonical" rel="canonical" href="{{ $seoCanonical }}">
        <meta inertia="og:site_name" property="og:site_name" content="{{ config('app.name', 'Red Unisol') }}">
        <meta inertia="og:type" property="og:type" content="{{ data_get($seo, 'ogType', 'website') }}">
        <meta inertia="og:title" property="og:title" content="{{ $seoTitle }}">
        <meta inertia="og:description" property="og:description" content="{{ $seoDescription }}">
        <meta inertia="og:image" property="og:image" content="{{ $seoImage }}">
        <meta inertia="og:url" property="og:url" content="{{ $seoCanonical }}">
        <meta inertia="twitter:card" name="twitter:card" content="summary_large_image">
        <meta inertia="twitter:title" name="twitter:title" content="{{ $seoTitle }}">
        <meta inertia="twitter:description" name="twitter:description" content="{{ $seoDescription }}">
        <meta inertia="twitter:image" name="twitter:image" content="{{ $seoImage }}">
        @endif

        <link rel="icon" href="/favicon.ico" sizes="any">
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">

        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">

        @viteReactRefresh
        @vite(['resources/js/app.tsx', "resources/js/pages/{$page['component']}.tsx"])
    </head>
    <body class="font-sans antialiased">
        @if(config('services.gtm.id'))
        <noscript>
        <iframe src="https://www.googletagmanager.com/ns.html?id={{ config('services.gtm.id') }}{{ $gtmDebugParams }}"
        height="0" width="0" style="display:none;visibility:hidden"></iframe>
        </noscript>
        @endif
        @if(config('services.meta.pixel_id'))
        <noscript>
        <img height="1" width="1" style="display:none"
        src="https://www.facebook.com/tr?id={{ config('services.meta.pixel_id') }}&ev=PageView&noscript=1" />
        </noscript>
        @endif
        @inertia
    </body>
</html>
