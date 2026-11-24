type Attempt = { id: string; digest: string; expires: number };

// Keep retry identity within this tab. No answers, phone or identity number go into storage.
const memory = new Map<string, Attempt>();
const storageKey = (landing: string) => 'redunisol:form-attempt:' + landing;

function uuid(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hash = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20)].join('-');
}

async function digest(id: string, fingerprint: string): Promise<string> {
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id + ':' + fingerprint));
    return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}

const pending = new Map<string, { fingerprint: string; task: Promise<string> }>();

export function webFormAttempt(landing: string, fingerprint: string): Promise<string> {
    const prior = pending.get(landing);
    if (prior?.fingerprint === fingerprint) return prior.task;
    const task = (prior?.task ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => loadAttempt(landing, fingerprint))
        .finally(() => {
            if (pending.get(landing)?.task === task) pending.delete(landing);
        });
    pending.set(landing, { fingerprint, task });
    return task;
}

async function loadAttempt(landing: string, fingerprint: string): Promise<string> {
    const key = storageKey(landing);
    let attempt = memory.get(key);
    if (!attempt && crypto.subtle) {
        try { attempt = JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined; } catch { /* Storage unavailable. */ }
    }
    if (attempt && typeof attempt.id === 'string' && attempt.expires > Date.now()) {
        const matches = crypto.subtle ? await digest(attempt.id, fingerprint) : fingerprint;
        if (attempt.digest === matches) return attempt.id;
    }
    const id = uuid();
    const next = { id, digest: crypto.subtle ? await digest(id, fingerprint) : fingerprint, expires: Date.now() + 23 * 3600000 };
    memory.set(key, next);
    if (crypto.subtle) {
        try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* In-memory retries still work. */ }
    }
    return id;
}

export function forgetWebFormAttempt(landing: string): void {
    const key = storageKey(landing);
    memory.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* Storage unavailable. */ }
}
