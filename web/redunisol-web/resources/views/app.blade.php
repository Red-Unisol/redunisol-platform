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

        <title inertia>{{ config('app.name', 'Red Unisol') }}</title>
        <meta name="description" content="{{ config('seo.meta.default_description', 'Soluciones de crédito personalizadas para jubilados y policías') }}">
        <meta property="og:site_name" content="{{ config('app.name', 'Red Unisol') }}">
        <meta property="og:type" content="website">
        <meta property="og:title" content="{{ config('app.name', 'Red Unisol') }}">
        <meta property="og:description" content="{{ config('seo.meta.default_description', 'Soluciones de crédito personalizadas para jubilados y policías') }}">
        <meta property="og:image" content="{{ asset('og-image.png') }}">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="{{ config('app.name', 'Red Unisol') }}">
        <meta name="twitter:description" content="{{ config('seo.meta.default_description', 'Soluciones de crédito personalizadas para jubilados y policías') }}">
        <meta name="twitter:image" content="{{ asset('og-image.png') }}">

        <link rel="icon" href="/favicon.ico" sizes="any">
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">

        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">

        @viteReactRefresh
        @vite(['resources/js/app.tsx', "resources/js/pages/{$page['component']}.tsx"])
        @inertiaHead
    </head>
    <body class="font-sans antialiased">
        @if(config('services.gtm.id'))
        <noscript>
        <iframe src="https://www.googletagmanager.com/ns.html?id={{ config('services.gtm.id') }}{{ $gtmDebugParams }}"
        height="0" width="0" style="display:none;visibility:hidden"></iframe>
        </noscript>
        @endif
        @inertia
    </body>
</html>
