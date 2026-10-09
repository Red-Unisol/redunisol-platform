import '../css/app.css';

import { createInertiaApp, router } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { initializeTheme } from './hooks/use-appearance';
import { formatPageTitle } from './lib/seo';
import { captureAnalyticsAttribution } from './utils/analyticsAttribution';
import { initializeWhatsAppAttribution } from './utils/whatsappAttribution';

const appName = import.meta.env.VITE_APP_NAME || 'Red Unisol';

createInertiaApp({
    title: (title) => formatPageTitle(title, appName),
    resolve: (name) =>
        resolvePageComponent(
            `./pages/${name}.tsx`,
            import.meta.glob('./pages/**/*.tsx'),
        ),
    setup({ el, App, props }) {
        if (props.initialPage.props.attributionEnabled) {
            initializeWhatsAppAttribution();
            const measurementId = String(
                props.initialPage.props.ga4MeasurementId ?? '',
            );
            // Read after the initial response cookie, and retry after Inertia navigation.
            void captureAnalyticsAttribution(measurementId);
            router.on(
                'navigate',
                () => void captureAnalyticsAttribution(measurementId),
            );
        }
        const root = createRoot(el);

        root.render(
            <StrictMode>
                <App {...props} />
            </StrictMode>,
        );
    },
    progress: {
        color: '#4B5563',
    },
});

// This will set light / dark mode on load...
initializeTheme();
