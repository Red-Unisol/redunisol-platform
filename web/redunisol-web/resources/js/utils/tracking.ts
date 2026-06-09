type TrackEventParams = Record<string, unknown>;

const trackingDebug = import.meta.env.VITE_TRACKING_DEBUG === 'true';

export const trackEvent = (event: string, data: TrackEventParams = {}) => {
    window.dataLayer = window.dataLayer || [];

    window.dataLayer.push({
        event,
        ...data,
    });

    if (trackingDebug) console.log('[Tracking]', event, data);
};

export const trackMetaLead = (
    eventId: string,
    data: TrackEventParams = {},
) => {
    if (!window.fbq) return;

    window.fbq(
        'track',
        'Lead',
        {
            content_name: 'lead_form',
            ...data,
        },
        { eventID: eventId },
    );

    if (trackingDebug) console.log('[Meta Pixel] Lead', eventId, data);
};
