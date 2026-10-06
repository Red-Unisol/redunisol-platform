// Synchronous handoff: preserves native new-tab/mobile behavior, including CMS links.
export function initializeWhatsAppAttribution() {
    const rewrite = (event: MouseEvent) => {
        const target =
            event.target instanceof Element ? event.target.closest('a') : null;
        if (!(target instanceof HTMLAnchorElement)) return;
        // The successful form submission has already captured its attribution.
        if (target.dataset.whatsappAttribution === 'skip') return;
        let url: URL;
        try {
            url = new URL(target.href);
        } catch {
            return;
        }
        if (url.protocol !== 'https:') return;
        const phone =
            url.hostname === 'wa.me'
                ? url.pathname.slice(1)
                : url.hostname === 'api.whatsapp.com' &&
                    url.pathname === '/send'
                  ? url.searchParams.get('phone')
                  : null;
        if (!phone || !/^[0-9]{10,15}$/.test(phone)) return;
        const text = url.searchParams.get('text') ?? '';
        if (text.length > 2048) return;
        const next = new URL('/whatsapp/start', window.location.origin);
        next.searchParams.set('phone', phone);
        next.searchParams.set('text', text);
        target.href = next.toString();
    };
    document.addEventListener('click', rewrite, true);
    document.addEventListener('auxclick', rewrite, true);
    document.addEventListener('contextmenu', rewrite, true);
}
