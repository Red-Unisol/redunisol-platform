// The opaque reference identifies the accepted server submission, not a browser claim.
export function withWebFormReference(link: string, reference: string | null): string {
    if (!reference || !/^[A-Za-z0-9]{32}$/.test(reference)) return link;
    try {
        const url = new URL(link);
        const whatsapp = url.protocol === 'https:' && (
            (url.hostname === 'wa.me' && /^\/[0-9]{10,15}$/.test(url.pathname)) ||
            (url.hostname === 'api.whatsapp.com' && url.pathname === '/send')
        );
        if (!whatsapp) return link;
        const text = (url.searchParams.get('text') ?? '')
            .replace(/\s*\(solicitud:[^)]*\)/gi, '');
        url.searchParams.set('text', `${text} (solicitud: ${reference})`.trim());
        return url.toString();
    } catch {
        return link;
    }
}
