import { usePage } from '@inertiajs/react';
import { useEffect, useRef } from 'react';

const debug = import.meta.env.VITE_TRACKING_DEBUG === 'true';
const ga4Debug = import.meta.env.VITE_GA4_DEBUG === 'true';

export default function useTracking() {
    const { url } = usePage();
    const isFirstRender = useRef(true);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        window.dataLayer = window.dataLayer || [];

        window.dataLayer.push({
            event: 'pageview',
            page: url,
            ...(ga4Debug && { debug_mode: true }),
        });

        if (debug) console.log('[Tracking] pageview:', url);
    }, [url]);
}
