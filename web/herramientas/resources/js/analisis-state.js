export function reconcileInbox(previous, items) {
    const assignments = Object.fromEntries(items.map((item) => [item.id, item.assignment]));
    const initialized = previous?.version === 1 && previous.assignments && typeof previous.assignments === 'object';
    const arrivals = initialized
        ? items.filter((item) => previous.assignments[item.id] !== item.assignment)
        : [];
    const unread = new Set(initialized && Array.isArray(previous.unread) ? previous.unread : []);
    for (const item of arrivals) unread.add(item.id);
    return {
        arrivals,
        state: { version: 1, assignments, unread: items.filter((item) => unread.has(item.id)).map((item) => item.id) },
    };
}

export function readSaved(storage, key, fallback = null) {
    try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function save(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function credixLink(item) {
    const digits = String(item.cuit || '').replace(/\D/g, '');
    const dni = String(item.dni || '').replace(/\D/g, '');
    const identifier = /^\d{11}$/.test(digits) ? digits : (/^\d{7,8}$/.test(dni) ? dni : '');
    // Fragment is processed by the page, not sent to the web server or in Referer.
    return `/credixsa#${new URLSearchParams({ cuit: identifier, nombre: item.name || '' })}`;
}

export function credixPrefill(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const digits = (params.get('cuit') || '').replace(/\D/g, '');
    return {
        cuit: /^(\d{7,8}|\d{11})$/.test(digits) ? digits : '',
        nombre: (params.get('nombre') || '').trim().slice(0, 200),
    };
}
