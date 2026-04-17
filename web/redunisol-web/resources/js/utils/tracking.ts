type TrackEventParams = Record<string, unknown>;

export const trackEvent = (event: string, data: TrackEventParams = {}) => {
    window.dataLayer = window.dataLayer || [];

    window.dataLayer.push({
        event,
        ...data,
    });

    console.log('[Tracking]', event, data);
};
