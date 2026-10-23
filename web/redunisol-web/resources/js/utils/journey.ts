// Raw, low frequency evidence. Never reads input values, uploads or page text.
type JourneyEvent = {
    event_id: string;
    type: string;
    occurred_at: string;
    page_id: string;
    url: string;
    referrer?: string;
    target?: string;
    step?: number;
    result?: string;
    elapsed_ms?: number;
    dropped_count?: number;
};
let enabled = false;
let pageId = '';
let entered = 0;
const queue: JourneyEvent[] = [];
let activeBatches = 0;
const inFlight = new Set<string>();
let retryAt = 0;
let failures = 0;
let dropped = 0;
let previousUrl = '';
const endpoint = '/api/journey/events';
const privatePath =
    /^\/(admin|api|dashboard|settings|login|register|logout|forgot-password|reset-password|confirm-password|two-factor-challenge|user|email|sanctum|health|up)(\/|$)/;
const keys = [
    'gclid',
    'gbraid',
    'wbraid',
    'fbclid',
    'msclkid',
    'ttclid',
    'dclid',
    'li_fat_id',
    'sccid',
    'twclid',
    'yclid',
    'irclickid',
    'epik',
    'gad_source',
    'gad_campaignid',
    'srsltid',
    '_gl',
    'ref',
];

export function journeyUrl(value: string): string {
    if (!value) return '';
    try {
        const url = new URL(value, location.href);
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            privatePath.test(url.pathname)
        )
            return '';
        const query = new URLSearchParams();
        url.searchParams.forEach((value, key) => {
            if (
                (key.startsWith('utm_') || keys.includes(key)) &&
                value &&
                key.length <= 80
            )
                query.set(key, value.slice(0, 512));
        });
        return `${url.origin}${url.pathname}${query.size ? `?${query}` : ''}`.slice(
            0,
            4096,
        );
    } catch {
        return '';
    }
}

export function trackJourney(
    type: string,
    data: Partial<JourneyEvent> = {},
): void {
    if (!enabled || privatePath.test(location.pathname)) return;
    // Bound memory during an outage. Keep original IDs and times for retries.
    if (queue.length >= 200) {
        dropped++;
        return;
    }
    queue.push({
        ...data,
        event_id: crypto.randomUUID(),
        type,
        occurred_at: new Date().toISOString(),
        page_id: pageId,
        url: journeyUrl(location.href),
    });
    if (queue.length >= 20) void flushJourney();
}

export async function flushJourney(leaving = false): Promise<void> {
    if (
        (!leaving && activeBatches > 0) ||
        activeBatches >= 3 ||
        (!leaving && Date.now() < retryAt)
    )
        return;
    const batch = queue
        .filter((event) => !inFlight.has(event.event_id))
        .slice(0, 20);
    if (!batch.length) return;
    // Stay below the 48 KiB server and keepalive budgets even with long URLs.
    while (
        new TextEncoder().encode(JSON.stringify({ events: batch })).length >
            12000 &&
        batch.length > 1
    )
        batch.pop();
    const body = JSON.stringify({ events: batch });
    activeBatches++;
    batch.forEach((event) => inFlight.add(event.event_id));
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        });
        if (
            response.status !== 202 ||
            (await response.json()).accepted !== batch.length
        )
            throw new Error('unavailable');
        const acknowledged = new Set(batch.map((event) => event.event_id));
        // Exit batches can finish out of order. Remove only acknowledged IDs.
        for (let index = queue.length - 1; index >= 0; index--) {
            if (acknowledged.has(queue[index].event_id)) queue.splice(index, 1);
        }
        failures = 0;
        retryAt = 0;
        if (dropped) {
            const count = dropped;
            dropped = 0;
            trackJourney('tracking.gap', {
                dropped_count: count,
                result: 'browser_queue_full',
            });
        }
    } catch {
        failures++;
        retryAt =
            Date.now() + Math.min(60000, 2000 * 2 ** Math.min(failures, 5));
    } finally {
        batch.forEach((event) => inFlight.delete(event.event_id));
        activeBatches--;
    }
}

export function getJourneyPageId(): string | undefined {
    return enabled && pageId ? pageId : undefined;
}

export function initializeJourney(initialPageId?: unknown): void {
    if (enabled || !crypto.randomUUID) return;
    enabled = true;
    const navigate = (serverPageId?: unknown) => {
        if (privatePath.test(location.pathname)) return;
        if (previousUrl === location.href) return;
        const referrer = previousUrl || document.referrer;
        previousUrl = location.href;
        pageId =
            typeof serverPageId === 'string' &&
            /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(serverPageId)
                ? serverPageId
                : crypto.randomUUID();
        entered = Date.now();
        trackJourney('page.view', { referrer: journeyUrl(referrer) });
    };
    navigate(initialPageId);
    window.addEventListener('journey:navigate', (event) =>
        navigate((event as CustomEvent).detail),
    );
    document.addEventListener(
        'click',
        (event) => {
            const link = (event.target as Element)?.closest?.(
                'a[href]',
            ) as HTMLAnchorElement | null;
            if (link && !link.pathname.startsWith('/admin'))
                trackJourney('link.click', { target: journeyUrl(link.href) });
        },
        true,
    );
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushJourney(true);
    });
    window.addEventListener('pagehide', () => {
        trackJourney('page.leave', {
            elapsed_ms: Math.min(86400000, Date.now() - entered),
        });
        void flushJourney(true);
    });
    window.setInterval(() => {
        void flushJourney();
    }, 10000);
}
