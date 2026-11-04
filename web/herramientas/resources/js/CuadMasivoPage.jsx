import React from 'react';
import { padronesApi as api } from './PadronesPage.jsx';
import '../css/bcra.css';
import '../css/cuad-masivo.css';

const post = (url, body) => api(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) });
// El navegador puede bloquear el storage: la corrida se sigue igual en memoria.
const storage = (kind, key) => ({
    get: () => { try { return window[kind].getItem(key); } catch { return null; } },
    set: (value) => { try { window[kind].setItem(key, value); } catch { /* opcional */ } },
    clear: () => { try { window[kind].removeItem(key); } catch { /* opcional */ } },
});
const recordada = storage('sessionStorage', 'cuad-masivo-corrida');
const nombreGuardado = storage('localStorage', 'cuad-masivo-nombre');
const number = (value) => Number(value || 0).toLocaleString('es-AR');
const date = (value) => value ? new Date(value).toLocaleString('es-AR') : '—';
const hora = (value) => value ? new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';

const ESTADOS = { en_cola: 'En cola', corriendo: 'Consultando', terminada: 'Terminada', incompleta: 'Incompleta',
    interrumpida: 'Interrumpida', fallo: 'No se pudo hacer' };
const CUENTAS = { esperando: 'Esperando turno', logueando: 'Entrando a CUAD', consultando: 'Consultando',
    pausa: 'Pausa entre CUIL', pausa_larga: 'Pausa larga', relogueando: 'Volviendo a entrar',
    caida: 'Caída', terminada: 'Terminó' };
const enCurso = (run) => run && (run.activa || ['en_cola', 'corriendo'].includes(run.estado));

function Login({ onLogin }) {
    const [password, setPassword] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    return <form className="padrones-login" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { await post('/cuad-masivo/login', { password }); setPassword(''); onLogin(); }
        catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
        <label>Contraseña de Riesgo<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        {error && <p role="alert">{error}</p>}
    </form>;
}

function Cuenta({ cuenta, onRetry, busy }) {
    const tono = cuenta.estado === 'caida' ? 'caida' : cuenta.frenada ? 'frenada' : cuenta.estado === 'terminada' ? 'fin' : 'ok';
    const desde = cuenta.estado === 'caida' ? ` desde ${hora(cuenta.desde)}` : '';
    return <div className={`cuad-cuenta cuad-cuenta--${tono}`}>
        <div className="bcra-row"><strong>Cuenta {cuenta.alias}</strong>
            <span className="cuad-cuenta__estado">{cuenta.frenada ? 'Frenada' : (CUENTAS[cuenta.estado] || cuenta.estado)}{desde}</span></div>
        <p>{number(cuenta.consultados)} consultados{cuenta.frenada && ` · sin novedades desde ${hora(cuenta.hasta || cuenta.desde)}`}</p>
        {cuenta.detalle && <p className="bcra-note">{cuenta.detalle}</p>}
        {cuenta.reintentable && <button type="button" disabled={busy} onClick={() => onRetry(cuenta.alias)}>Reintentar cuenta {cuenta.alias}</button>}
        {cuenta.frenada && !cuenta.reintentable && <p className="bcra-note">Si sigue así unos minutos más, avisá a Sistemas.</p>}
    </div>;
}

function Corrida({ run, onRetry, onResume, busy }) {
    const m = run.metadata || {};
    const { hechos = 0, total = 0 } = run.progreso || {};
    const pct = total ? Math.min(100, Math.round((hechos / total) * 100)) : 0;
    const tono = run.estado === 'fallo' ? 'failed' : ['incompleta', 'interrumpida'].includes(run.estado) ? 'needs_review' : 'success';
    return <article className={`bcra-result bcra-result--${tono}`} aria-live="polite">
        <div className="bcra-row"><div><p className="section__eyebrow">{m.origen || 'Corrida nueva'}</p>
            <h2>{ESTADOS[run.estado] || run.estado}</h2></div>
            {enCurso(run) && <span className="bcra-spinner" aria-label="Procesando" />}</div>
        {run.estado === 'en_cola' && <p>Kestra está preparando la corrida (instalar dependencias tarda alrededor de un minuto).</p>}
        {total > 0 && <>
            <div className="cuad-progreso" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={hechos}><span style={{ width: `${pct}%` }} /></div>
            <p className="bcra-note">{number(hechos)} de {number(total)} CUIL resueltos ({pct}%)</p>
        </>}
        {run.cuentas?.length > 0 && <div className="cuad-cuentas">{run.cuentas.map((c) => <Cuenta key={c.alias} cuenta={c} onRetry={onRetry} busy={busy} />)}</div>}
        {!enCurso(run) && m.total > 0 && <div className="bcra-metrics">
            <div><strong>{number(m.ok)}</strong><span>con datos</span></div>
            <div><strong>{number(m.sin_resultado)}</strong><span>sin resultado en CUAD</span></div>
            <div><strong>{number(m.pendientes)}</strong><span>pendientes (incluye {number(m.error)} con error)</span></div>
        </div>}
        {m.motivo && <p role="alert">{m.motivo}</p>}
        {run.estado === 'interrumpida' && <p>La corrida se cortó. Lo consultado quedó guardado: al retomarla sigue desde donde quedó.</p>}
        {run.estado === 'incompleta' && <p>Quedaron CUIL sin resolver (errores o cuentas caídas). Al retomarla se vuelven a intentar solo esos.</p>}
        {(m.invalidos > 0 || m.duplicados > 0) && <p className="bcra-note">No se consultaron {number(m.invalidos)} CUIL inválidos y {number(m.duplicados)} repetidos.</p>}
        {m.advertencias?.map((a) => <p className="bcra-note" key={a}>{a}</p>)}
        <div className="bcra-downloads">
            {m.descarga && <a className="bcra-primary" href={m.descarga}>Descargar resultado (.ndjson) ↓</a>}
            {['interrumpida', 'incompleta'].includes(run.estado) && <button type="button" disabled={busy} onClick={() => onResume(run.corrida_id)}>Retomar corrida</button>}
        </div>
    </article>;
}

export default function CuadMasivoPage({ config }) {
    const [authenticated, setAuthenticated] = React.useState(config.authenticated);
    const [nombre, setNombre] = React.useState(() => nombreGuardado.get() || '');
    const [archivo, setArchivo] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [current, setCurrent] = React.useState(null);
    const [history, setHistory] = React.useState({ corridas: [], en_cola: [] });
    const [polling, setPolling] = React.useState(0);
    const [pollError, setPollError] = React.useState('');
    const fileInput = React.useRef(null);
    const starting = React.useRef(false);
    const linea = config.linea || {};
    const hayActiva = enCurso(current) || history.en_cola?.length > 0 || history.corridas?.some((r) => r.estado === 'corriendo');

    const failed = (err) => {
        if (err.status === 401) { setAuthenticated(false); setCurrent(null); setHistory({ corridas: [], en_cola: [] }); }
        setError(err.status === 419 ? 'La sesión venció. Recargá la página para continuar.' : err.message);
    };
    const ver = async (corrida, execution) => {
        const query = execution ? `?execution=${encodeURIComponent(execution)}` : '';
        const run = await api(`/api/cuad-masivo/corridas/${encodeURIComponent(corrida)}${query}`);
        setCurrent(run); recordada.set(JSON.stringify({ corrida, execution: run.execution_id }));
        setPolling((n) => n + 1);
        return run;
    };
    const cargarHistorial = async () => setHistory(await api('/api/cuad-masivo/corridas'));
    const load = async () => {
        setBusy(true); setError('');
        try {
            const data = await api('/api/cuad-masivo/corridas'); setHistory(data);
            const guardada = JSON.parse(recordada.get() || 'null');
            const activa = data.corridas.find((r) => r.estado === 'corriendo');
            if (guardada?.corrida) await ver(guardada.corrida, guardada.execution);
            else if (activa) await ver(activa.metadata.corrida_id);
            else if (data.en_cola[0]) await ver(data.en_cola[0].corrida_id, data.en_cola[0].execution_id);
        } catch (err) { if (err.status === 404) recordada.clear(); else failed(err); } finally { setBusy(false); }
    };
    React.useEffect(() => { if (authenticated) load(); }, [authenticated]);
    React.useEffect(() => {
        if (!authenticated || !enCurso(current)) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const query = `?execution=${encodeURIComponent(current.execution_id)}`;
                const run = await api(`/api/cuad-masivo/corridas/${encodeURIComponent(current.corrida_id)}${query}`, { signal: controller.signal });
                setCurrent(run); setPollError('');
                if (!enCurso(run)) setHistory(await api('/api/cuad-masivo/corridas', { signal: controller.signal }));
            } catch (err) {
                if (err.name !== 'AbortError') {
                    if (err.status === 401) failed(err);
                    else setPollError('No pudimos actualizar el estado. La corrida puede seguir en curso; volvemos a consultar.');
                }
            } finally { if (!controller.signal.aborted) setPolling((n) => n + 1); }
        }, 5000);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [authenticated, current?.corrida_id, current?.execution_id, current?.estado, polling]);

    const accion = async (fn) => {
        if (starting.current) return;
        starting.current = true; setBusy(true); setError('');
        try { await fn(); } catch (err) { failed(err); } finally { starting.current = false; setBusy(false); }
    };
    const iniciar = (modo) => accion(async () => {
        if (!nombre.trim()) throw new Error('Completá tu nombre antes de lanzar la corrida.');
        nombreGuardado.set(nombre.trim());
        const form = new FormData();
        form.append('modo', modo); form.append('lanzado_por', nombre.trim());
        if (modo === 'excel') {
            if (!archivo) throw new Error('Elegí el Excel con los CUIL.');
            form.append('archivo', archivo);
        }
        const result = await post('/api/cuad-masivo/corridas', form);
        if (fileInput.current) fileInput.current.value = '';
        setArchivo(null);
        await ver(result.corrida_id, result.execution_id); await cargarHistorial();
    });
    const retomar = (corrida) => accion(async () => {
        if (!nombre.trim()) throw new Error('Completá tu nombre antes de retomar la corrida.');
        const result = await post(`/api/cuad-masivo/corridas/${encodeURIComponent(corrida)}/retomar`, { lanzado_por: nombre.trim() });
        await ver(result.corrida_id, result.execution_id); await cargarHistorial();
    });
    const reintentar = (alias) => accion(async () => {
        await post(`/api/cuad-masivo/corridas/${encodeURIComponent(current.corrida_id)}/reintentar/${alias}`, {});
        setPollError(`Pedido enviado: la cuenta ${alias} vuelve a entrar en unos segundos.`);
    });

    return <main className="bcra-page cuad-page">
        <nav><a href="/">← Herramientas</a><span>Celesol · Análisis de crédito</span></nav>
        <header className="bcra-heading"><div><p className="section__eyebrow">CUAD Santa Fe · Cuentas A y B</p>
            <h1>Consulta CUAD masiva</h1><p>Consultá en CUAD una lista de CUIL con las dos cuentas a la vez. El resultado de cada corrida queda guardado para descargar.</p></div>
            <img src="/brand/red-unisol-logo.png" alt="Red Unisol" /></header>
        {!authenticated ? <section className="panel"><h2>Acceso de Riesgo</h2>
            {config.accessConfigured ? <Login onLogin={() => setAuthenticated(true)} /> : <p>El acceso todavía no está configurado.</p>}
        </section> : <>
            {!config.configured && <p className="bcra-alert" role="alert">La conexión con Kestra todavía no está configurada.</p>}
            {error && <p className="bcra-alert" role="alert">{error}</p>}
            <section className="panel">
                <div className="bcra-row"><h2>Nueva corrida</h2>{hayActiva && <span className="bcra-badge">Hay una corrida en curso</span>}</div>
                <label className="cuad-nombre">Tu nombre<input required maxLength={80} value={nombre} placeholder="Queda en el historial de la corrida" onChange={(e) => setNombre(e.target.value)} /></label>
                <div className="cuad-opciones">
                    <div className="cuad-opcion">
                        <h3>1. Desde un Excel</h3>
                        <label>Excel con los CUIL<input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></label>
                        <div className="bcra-basis cuad-formato"><strong>Formato del Excel</strong>
                            <ul>
                                <li>Archivo <strong>.xlsx</strong> (no .xls ni .csv). Se lee solo la <strong>primera hoja</strong>.</li>
                                <li>Una columna con el título <strong>CUIL</strong> o <strong>CUIT</strong>, en alguna de las primeras 10 filas.</li>
                                <li>Un CUIL por fila, con o sin guiones (20-12345678-6 o 20123456786).</li>
                                <li>Los CUIL inválidos o repetidos no se consultan y quedan informados.</li>
                            </ul></div>
                        <button className="bcra-primary" type="button" disabled={busy || hayActiva || !config.configured || !archivo} onClick={() => iniciar('excel')}>{busy ? 'Iniciando…' : 'Consultar Excel →'}</button>
                    </div>
                    <div className="cuad-opcion">
                        <h3>2. Socios de la línea {linea.id}</h3>
                        <p>Consulta todos los socios con algún préstamo en la línea superior <strong>{linea.id} · {linea.nombre}</strong>, tomados de Vimarx en el momento.</p>
                        <p className="bcra-note">Son cerca de dos mil socios: la corrida dura varias horas.</p>
                        <button className="bcra-primary" type="button" disabled={busy || hayActiva || !config.configured} onClick={() => iniciar('linea')}>{busy ? 'Iniciando…' : `Consultar línea ${linea.id} →`}</button>
                    </div>
                </div>
                <p className="bcra-note">Una corrida a la vez. Cada cuenta consulta un CUIL cada 15 s y descansa 3 min cada 50 (con las dos, unos 500 CUIL por hora). Podés cerrar esta página: la corrida sigue en Kestra.</p>
            </section>
            {pollError && <p role="status">{pollError}</p>}
            {current && <Corrida run={current} onRetry={reintentar} onResume={retomar} busy={busy} />}
            <section className="panel bcra-history"><div className="bcra-row"><h2>Historial de corridas</h2><button type="button" onClick={() => cargarHistorial().catch(failed)}>Actualizar historial</button></div>
                {!history.corridas.length ? <p>Todavía no hay corridas registradas.</p> : <div className="bcra-history-table"><table><thead><tr>
                    <th>Inicio</th><th>Origen</th><th>Lanzada por</th><th>Estado</th><th>Con datos</th><th>Sin resultado</th><th>Pendientes</th><th>Acciones</th></tr></thead><tbody>
                    {history.corridas.map((r) => <tr key={r.metadata.corrida_id}>
                        <td>{date(r.metadata.creada_en)}</td><td>{r.metadata.origen || '—'}</td><td>{r.metadata.lanzado_por || '—'}</td>
                        <td>{ESTADOS[r.estado] || r.estado}{r.metadata.motivo && <small className="cuad-motivo">{r.metadata.motivo}</small>}</td>
                        <td>{number(r.metadata.ok)}</td><td>{number(r.metadata.sin_resultado)}</td><td>{number(r.metadata.pendientes)}</td>
                        <td><div className="bcra-downloads">
                            <button type="button" onClick={() => ver(r.metadata.corrida_id).catch(failed)}>Ver</button>
                            {r.metadata.descarga && <a href={r.metadata.descarga}>Descargar .ndjson</a>}
                            {r.retomable && <button type="button" disabled={busy || hayActiva} onClick={() => retomar(r.metadata.corrida_id)}>Retomar</button>}
                        </div></td></tr>)}
                </tbody></table></div>}
            </section>
        </>}
    </main>;
}
