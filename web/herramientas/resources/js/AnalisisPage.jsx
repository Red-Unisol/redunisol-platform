import React from 'react';
import { credixLink, readSaved, reconcileInbox, save } from './analisis-state.js';
import '../css/analisis.css';

const preferenceKey = 'analisis:analyst';
// Access to window.localStorage itself can throw when persistence is blocked.
const storage = { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
const inboxKey = (analyst) => `analisis:inbox:v1:${analyst.toLowerCase()}`;
const notificationPermission = () => 'Notification' in window ? Notification.permission : 'unsupported';
const withLock = (key, callback) => navigator.locks ? navigator.locks.request(key, callback) : Promise.resolve().then(callback);

async function api(url, options = {}) {
    const response = await fetch(url, {
        cache: 'no-store', credentials: 'same-origin', ...options,
        headers: {
            Accept: 'application/json', 'Content-Type': 'application/json',
            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || '',
            ...options.headers,
        },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(body.message || 'No pudimos completar la consulta. Volvé a intentar.');
        error.status = response.status;
        throw error;
    }
    return body;
}

export default function AnalisisPage({ config }) {
    const [authenticated, setAuthenticated] = React.useState(config.authenticated);
    const [password, setPassword] = React.useState('');
    const [analysts, setAnalysts] = React.useState([]);
    const [analyst, setAnalyst] = React.useState(() => readSaved(storage, preferenceKey, ''));
    const [items, setItems] = React.useState([]);
    const [unread, setUnread] = React.useState([]);
    const [updatedAt, setUpdatedAt] = React.useState('');
    const [error, setError] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [permission, setPermission] = React.useState(notificationPermission);
    const [storageWarning, setStorageWarning] = React.useState(false);
    const [notificationError, setNotificationError] = React.useState('');
    const [retry, setRetry] = React.useState(0);
    const memory = React.useRef(new Map());
    const pollRef = React.useRef(null);
    const refreshSeconds = config.refreshSeconds || 45;

    const sessionExpired = React.useCallback((err) => {
        if (err.status === 401 || err.status === 419) {
            setAuthenticated(false); setItems([]); setUnread([]); setUpdatedAt('');
            setError('La sesión venció. Recargá la página e ingresá nuevamente.');
            return true;
        }
        return false;
    }, []);

    React.useEffect(() => {
        if (!authenticated) return;
        const controller = new AbortController();
        api('/api/analisis/analysts', { signal: controller.signal }).then((body) => {
            setAnalysts(body.analysts);
            if (analyst && !body.analysts.some((entry) => entry.username === analyst)) {
                setAnalyst(''); save(storage, preferenceKey, '');
            }
        }).catch((err) => {
            if (err.name !== 'AbortError' && !sessionExpired(err)) setError('No pudimos cargar los analistas. Volvé a intentar.');
        });
        return () => controller.abort();
    }, [authenticated, retry, sessionExpired]);

    React.useEffect(() => {
        setItems([]); setUnread([]); setUpdatedAt('');
        if (!authenticated || !analyst || !analysts.some((entry) => entry.username === analyst)) return;
        let cancelled = false;
        let timer;
        let inFlight = false;
        const controller = new AbortController();
        const key = inboxKey(analyst);

        const poll = async () => {
            if (cancelled || inFlight) return;
            clearTimeout(timer);
            inFlight = true; setLoading(true);
            try {
                const body = await api(`/api/analisis/snapshot?${new URLSearchParams({ analyst })}`, { signal: controller.signal });
                if (cancelled) return;
                if (!Array.isArray(body.items) || !body.updated_at) throw new Error('La respuesta de Vimarx está incompleta. Volveremos a intentar.');
                await withLock(key, () => {
                    if (cancelled) return;
                    const previous = readSaved(storage, key, memory.current.get(key));
                    const next = reconcileInbox(previous, body.items);
                    memory.current.set(key, next.state);
                    setStorageWarning(!save(storage, key, next.state));
                    setItems(body.items); setUnread(next.state.unread); setUpdatedAt(body.updated_at); setError('');
                    setPermission(notificationPermission());
                    if (notificationPermission() === 'granted' && next.arrivals.length) {
                        const first = next.arrivals[0];
                        try {
                            const notification = new Notification(next.arrivals.length === 1
                                ? `Nueva asignación · Solicitud ${first.id}`
                                : `${next.arrivals.length} nuevas asignaciones`, {
                                body: next.arrivals.length === 1 ? first.name : `Hay novedades en la bandeja de ${analyst}.`,
                                icon: '/brand/red-unisol-mark.png', tag: `analisis:${analyst}`,
                            });
                            notification.onclick = () => { window.focus(); notification.close(); };
                        } catch {
                            setNotificationError('El navegador no pudo mostrar el aviso. Las novedades siguen marcadas en la lista.');
                        }
                    }
                });
            } catch (err) {
                if (!cancelled && err.name !== 'AbortError' && !sessionExpired(err)) setError(err.message);
            } finally {
                if (!cancelled) { setLoading(false); timer = setTimeout(poll, refreshSeconds * 1000); }
                inFlight = false;
            }
        };
        const resume = () => { if (document.visibilityState === 'visible') poll(); };
        const sync = (event) => {
            if (event.key === key) setUnread(readSaved(storage, key)?.unread || []);
        };
        pollRef.current = poll;
        poll();
        window.addEventListener('online', poll);
        window.addEventListener('storage', sync);
        document.addEventListener('visibilitychange', resume);
        return () => {
            cancelled = true; controller.abort(); clearTimeout(timer); pollRef.current = null;
            window.removeEventListener('online', poll);
            window.removeEventListener('storage', sync);
            document.removeEventListener('visibilitychange', resume);
        };
    }, [authenticated, analyst, analysts, refreshSeconds, sessionExpired]);

    const login = async (event) => {
        event.preventDefault(); setLoading(true); setError('');
        try {
            await api('/analisis/login', { method: 'POST', body: JSON.stringify({ password }) });
            // Reload receives the CSRF token regenerated along with the session.
            window.location.reload();
        } catch (err) { setError(err.status === 419 ? 'La sesión venció. Recargá la página para ingresar.' : err.message); }
        finally { setPassword(''); setLoading(false); }
    };

    const logout = async () => {
        try {
            await api('/analisis/logout', { method: 'POST' });
            window.location.reload();
        } catch (err) { if (!sessionExpired(err)) setError(err.message); }
    };

    const markRead = async (id) => {
        const key = inboxKey(analyst);
        await withLock(key, () => {
            const saved = readSaved(storage, key, memory.current.get(key));
            if (!saved) return;
            const next = { ...saved, unread: (saved.unread || []).filter((value) => value !== id) };
            memory.current.set(key, next); save(storage, key, next); setUnread(next.unread);
        });
    };

    const enableNotifications = async () => {
        try { setPermission(await Notification.requestPermission()); setNotificationError(''); }
        catch { setNotificationError('No pudimos activar las notificaciones en este navegador.'); }
    };

    return (
        <div className="shell analysis-shell">
            <header className="analysis-topbar">
                <a href="/" aria-label="Volver a Herramientas"><img src="/brand/red-unisol-logo.png" alt="Red Unisol" /></a>
                {authenticated && <button className="analysis-link" onClick={logout}>Cerrar sesión</button>}
            </header>
            <main>
                <div className="analysis-heading">
                    <p className="section__eyebrow">ANÁLISIS DE CRÉDITO</p>
                    <h1>Tu bandeja de solicitudes</h1>
                    <p>Las asignaciones de Vimarx, a mano para empezar a analizar.</p>
                </div>
                {!authenticated ? (
                    <form className="analysis-login" onSubmit={login}>
                        <h2>Ingresar a la bandeja</h2>
                        <p>Usá la contraseña compartida del equipo.</p>
                        {!config.configured && <p role="status">La bandeja todavía no está habilitada.</p>}
                        <label htmlFor="analysis-password">Contraseña</label>
                        <input id="analysis-password" type="password" autoComplete="current-password" required maxLength={200}
                            value={password} onChange={(event) => setPassword(event.target.value)} disabled={!config.configured} />
                        {error && <p className="analysis-error" role="alert">{error}</p>}
                        <button className="analysis-primary" type="submit" disabled={loading || !config.configured}>{loading ? 'Ingresando…' : 'Ingresar'}</button>
                    </form>
                ) : (
                    <>
                        <section className="analysis-controls" aria-label="Preferencias de la bandeja">
                            <div className="analysis-selector">
                                <label htmlFor="analysis-analyst">Analista en Vimarx</label>
                                <select id="analysis-analyst" value={analyst} onChange={(event) => {
                                    setAnalyst(event.target.value); setError('');
                                    setStorageWarning(!save(storage, preferenceKey, event.target.value));
                                }}>
                                    <option value="">Seleccioná un analista</option>
                                    {analysts.map((entry) => <option value={entry.username} key={entry.username}>{entry.username} · {entry.name}</option>)}
                                </select>
                            </div>
                            <div className="analysis-notifications">
                                {permission === 'default' && <button className="analysis-primary" onClick={enableNotifications}>Activar notificaciones</button>}
                                {permission === 'granted' && <strong className="analysis-enabled">Notificaciones activadas</strong>}
                                {permission === 'denied' && <strong>Notificaciones bloqueadas</strong>}
                                {permission === 'unsupported' && <strong>Notificaciones no disponibles</strong>}
                                <p>{permission === 'denied' ? 'Podés habilitarlas en los permisos del sitio. La lista sigue funcionando.'
                                    : permission === 'unsupported' ? 'Podés seguir las novedades en esta lista.' : 'Mantené esta pestaña abierta, aunque trabajes en otra ventana.'}</p>
                            </div>
                        </section>
                        {storageWarning && <p className="analysis-warning" role="status">Este navegador no permite recordar la selección y las novedades al cerrar la página.</p>}
                        {notificationError && <p className="analysis-warning" role="status">{notificationError}</p>}
                        {error && <div className="analysis-error" role="alert">{error} <button className="analysis-link" onClick={() => pollRef.current ? pollRef.current() : setRetry((value) => value + 1)}>Reintentar</button></div>}
                        <section className="analysis-inbox" aria-label="Solicitudes asignadas">
                            <div className="analysis-summary">
                                <div><h2>Solicitudes asignadas <span className="analysis-count">{items.length}</span></h2>
                                    {unread.length > 0 && <p>{unread.length} con novedades desde tu última consulta</p>}</div>
                                <p className="analysis-update" role="status">{loading ? 'Actualizando…' : updatedAt
                                    ? `Actualizado ${new Date(updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · cada ${refreshSeconds} s`
                                    : 'Esperando selección'}</p>
                            </div>
                            {!analyst ? <div className="analysis-empty"><h3>Elegí a quién seguir</h3><p>Seleccioná un analista para ver sus solicitudes pendientes.</p></div>
                                : !updatedAt ? <div className="analysis-empty"><p>{error ? 'La lista aún no está disponible.' : 'Consultando asignaciones…'}</p></div>
                                    : items.length === 0 ? <div className="analysis-empty"><h3>No hay solicitudes pendientes</h3><p>Las nuevas asignaciones aparecerán acá automáticamente.</p></div>
                                        : <div className="analysis-table-wrap"><table className="analysis-table">
                                            <thead><tr><th>Solicitud</th><th>Socio</th><th>DNI</th><th>Estado</th><th><span className="analysis-sr-only">Informe</span></th></tr></thead>
                                            <tbody>{items.map((item) => <tr key={item.id} className={unread.includes(item.id) ? 'analysis-new' : ''}>
                                                <td><strong>#{item.id}</strong>{unread.includes(item.id) && <span className="analysis-badge">Nueva</span>}</td>
                                                <td>{item.name || 'Sin nombre'}</td><td className="analysis-dni">{item.dni || 'Sin dato'}</td>
                                                <td><span className="analysis-state">{item.state}</span></td>
                                                <td><a className="analysis-open" href={credixLink(item)} target="_blank" rel="noopener noreferrer" onClick={() => markRead(item.id)}>Abrir Credixsa <span aria-hidden="true">↗</span><span className="analysis-sr-only"> de solicitud {item.id}, en otra pestaña</span></a></td>
                                            </tr>)}</tbody>
                                        </table></div>}
                        </section>
                        <p className="analysis-footnote">La lista se actualiza con los estados y ejecutivos de Vimarx. Abrir un informe no modifica la solicitud.</p>
                    </>
                )}
            </main>
        </div>
    );
}
