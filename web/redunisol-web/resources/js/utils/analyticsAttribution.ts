// Read existing GA4 state; never configure another Google tag or parse GA cookies.
export async function captureAnalyticsAttribution(
    measurementId: string,
): Promise<void> {
    if (!/^G-[A-Z0-9]+$/.test(measurementId) || !window.dataLayer) return;

    const gtag: (...args: unknown[]) => void =
        window.gtag ??
        function () {
            // Google's command queue uses an Arguments object, not an event object.
            // eslint-disable-next-line prefer-rest-params
            window.dataLayer.push(arguments);
        };

    const get = (field: string): Promise<unknown> =>
        new Promise((resolve) => {
            const timeout = window.setTimeout(() => resolve(undefined), 4000);
            try {
                gtag('get', measurementId, field, (value: unknown) => {
                    window.clearTimeout(timeout);
                    resolve(value);
                });
            } catch {
                window.clearTimeout(timeout);
                resolve(undefined);
            }
        });

    const [client, session] = await Promise.all([
        get('client_id'),
        get('session_id'),
    ]);
    if (
        typeof client !== 'string' ||
        !/^[0-9]{1,20}\.[0-9]{1,20}$/.test(client)
    )
        return;

    const sessionId =
        typeof session === 'string' || typeof session === 'number'
            ? String(session)
            : '';
    const payload = {
        ga_client_id: client,
        ...(/^[0-9]{1,20}$/.test(sessionId)
            ? { ga_session_id: sessionId }
            : {}),
    };
    try {
        await fetch('/api/attribution/analytics', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
            keepalive: true,
        });
    } catch {
        // Analytics is optional; submission and native WhatsApp navigation never wait.
    }
}
