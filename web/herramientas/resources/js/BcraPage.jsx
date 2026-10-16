import React from 'react';
import { padronesApi, PadronesLogin } from './PadronesPage.jsx';
import '../css/bcra.css';

const post = (url, body) => padronesApi(url, { method: 'POST', body: JSON.stringify(body) });
// Storage can be disabled by the browser. A confirmed start must still be observed.
const rememberedExecution = {
    get: () => { try { return sessionStorage.getItem('bcra-active-execution'); } catch { return null; } },
    set: (id) => { try { sessionStorage.setItem('bcra-active-execution', id); } catch { /* Polling remains active in memory. */ } },
    clear: () => { try { sessionStorage.removeItem('bcra-active-execution'); } catch { /* Optional recovery only. */ } },
};
const number = (value) => Number(value || 0).toLocaleString('es-AR');
const date = (value) => value ? new Date(value).toLocaleString('es-AR') : '—';
const searchText = (value) => value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const finished = new Set(['SUCCESS', 'NEEDS_REVIEW', 'FAILED', 'KILLED', 'CANCELLED', 'WARNING']);
const labels = { SUCCESS: 'Archivo generado', NEEDS_REVIEW: 'Generado con incidencias', FAILED: 'No se pudo generar',
    RUNNING: 'Generando', CREATED: 'En cola', QUEUED: 'En cola', KILLED: 'Interrumpido', CANCELLED: 'Cancelado', WARNING: 'Revisar ejecución' };

export function parseExclusions(text, kind) {
    return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.indexOf(';');
        const value = separator < 0 ? line : line.slice(0, separator).trim();
        const reason = separator < 0 ? '' : line.slice(separator + 1).trim();
        if (!reason) throw new Error('Cada exclusión necesita un motivo: valor; motivo.');
        if (kind === 'cuit' && !/^\d{11}$/.test(value)) throw new Error('Cada CUIT debe tener 11 dígitos, sin guiones.');
        return { value, reason };
    });
}

export function GroupCheck({ lines, selected, onChange, disabled }) {
    const included = lines.filter((line) => selected.includes(line.id)).length;
    const ref = React.useRef(null);
    React.useEffect(() => { if (ref.current) ref.current.indeterminate = included > 0 && included < lines.length; }, [included, lines.length]);
    return <input ref={ref} type="checkbox" disabled={disabled} checked={included === lines.length}
        aria-label={`Incluir todas las líneas de ${lines[0].superior_name}`}
        onChange={(e) => onChange(e.target.checked)} />;
}

function Downloads({ downloads = {} }) {
    return <div className="bcra-downloads">
        {downloads.zip && <a className="bcra-primary" href={downloads.zip}>Descargar ZIP BCRA ↓</a>}
        {downloads.excel && <a href={downloads.excel}>Excel de control</a>}
        {downloads.errors && <a href={downloads.errors}>Incidencias CSV</a>}
        {downloads.config && <a href={downloads.config}>Configuración aplicada</a>}
        {downloads.control && <a href={downloads.control}>Totales de control</a>}
    </div>;
}

function RunResult({ run }) {
    const metadata = run.metadata || {};
    const state = metadata.status || run.status;
    return <article className={`bcra-result bcra-result--${state.toLowerCase()}`} aria-live="polite">
        <div className="bcra-row"><div><p className="section__eyebrow">{metadata.period || 'Presentación en curso'}</p>
            <h2>{labels[state] || 'Preparando presentación'}</h2></div>
            {!finished.has(state) && <span className="bcra-spinner" aria-label="Procesando" />}</div>
        {metadata.debtors !== undefined && <div className="bcra-metrics">
            <div><strong>{number(metadata.debtors)}</strong><span>socios informados</span></div>
            <div><strong>{number(metadata.loans)}</strong><span>préstamos incluidos</span></div>
            <div><strong>{number(metadata.total_miles)}</strong><span>deuda · miles de pesos</span></div>
        </div>}
        {state === 'NEEDS_REVIEW' && <p role="alert">Hay {number((metadata.errors || 0) + (metadata.warnings || 0))} incidencias en los datos. Revisá el Excel y el detalle de incidencias antes de presentar.</p>}
        {metadata.message && <p role="alert">{metadata.message}</p>}
        {finished.has(state) && !run.downloads?.zip && !metadata.message && <p>La corrida terminó sin un ZIP disponible. Revisá sus controles y la configuración antes de generar otra.</p>}
        <Downloads downloads={run.downloads} />
        {metadata.balance_extracted_at && <p className="bcra-note">Saldos consultados: {date(metadata.balance_extracted_at)} · Corte de mora: {metadata.cutoff}.</p>}
    </article>;
}

export default function BcraPage({ config }) {
    const [authenticated, setAuthenticated] = React.useState(config.authenticated);
    const [catalog, setCatalog] = React.useState(null);
    const [selected, setSelected] = React.useState([]);
    const [special, setSpecial] = React.useState([]);
    const [period, setPeriod] = React.useState(config.latestClosedMonth);
    const [declaredBy, setDeclaredBy] = React.useState('');
    const [rate, setRate] = React.useState('');
    const [granted, setGranted] = React.useState(true);
    const [presentation, setPresentation] = React.useState('NORMAL');
    const [cuits, setCuits] = React.useState('');
    const [accounts, setAccounts] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [current, setCurrent] = React.useState(null);
    const [history, setHistory] = React.useState([]);
    const [polling, setPolling] = React.useState(0);
    const [pollError, setPollError] = React.useState('');
    const starting = React.useRef(false);
    const groups = Object.values((catalog?.lines || []).reduce((all, line) => {
        (all[line.superior_id] ||= { id: line.superior_id, name: line.superior_name, lines: [] }).lines.push(line);
        return all;
    }, {})).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const active = current && !finished.has(current.metadata?.status || current.status);
    const restore = (data = catalog) => {
        setSelected(data.lines.filter((line) => line.included_by_default).map((line) => line.id));
        setSpecial([...new Set(data.lines.filter((line) => line.normal_until_66_by_default).map((line) => line.superior_id))]);
        setCuits(data.excluded_cuits.map((item) => `${item.value}; ${item.reason}`).join('\n')); setAccounts('');
    };
    const failed = (err) => {
        if (err.status === 401) { setAuthenticated(false); setCatalog(null); setHistory([]); setCurrent(null); }
        setError(err.status === 419 ? 'La sesión venció. Recargá la página para continuar.' : err.message);
    };
    const load = async () => {
        setBusy(true); setError('');
        try {
            const data = await padronesApi('/api/bcra/catalog'); setCatalog(data); restore(data);
            setHistory((await padronesApi('/api/bcra/runs')).runs);
            const execution = rememberedExecution.get();
            if (execution) { setCurrent(await padronesApi(`/api/bcra/executions/${encodeURIComponent(execution)}`)); }
        } catch (err) { failed(err); } finally { setBusy(false); }
    };
    React.useEffect(() => { if (authenticated) load(); }, [authenticated]);
    React.useEffect(() => {
        if (!authenticated || !active || !current?.execution_id) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const result = await padronesApi(`/api/bcra/executions/${encodeURIComponent(current.execution_id)}`, { signal: controller.signal });
                setCurrent(result); setPollError('');
                if (finished.has(result.metadata?.status || result.status)) {
                    rememberedExecution.clear();
                    setHistory((await padronesApi('/api/bcra/runs', { signal: controller.signal })).runs);
                }
            } catch (err) {
                if (err.name !== 'AbortError') {
                    if (err.status === 401) failed(err);
                    else setPollError('No pudimos actualizar el estado. La generación puede seguir en curso; volveremos a consultar.');
                }
            } finally { if (!controller.signal.aborted) setPolling((n) => n + 1); }
        }, 4000);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [authenticated, active, current?.execution_id, polling]);
    const toggle = (ids, included) => setSelected((previous) => included
        ? [...new Set([...previous, ...ids])] : previous.filter((id) => !ids.includes(id)));
    const submit = async (event) => {
        event.preventDefault();
        if (starting.current || active) return;
        starting.current = true;
        setError(''); setBusy(true);
        try {
            const data = { period, declared_by: declaredBy, rate: granted ? rate : '000,00', presentation_type: presentation,
                granted_without_real_guarantee: granted, selected_line_ids: selected, normal_until_66_superior_ids: special,
                excluded_cuits: parseExclusions(cuits, 'cuit'), excluded_accounts: parseExclusions(accounts, 'account') };
            const result = await post('/api/bcra/runs', data);
            setCurrent(result); setPollError(''); setPolling((n) => n + 1);
            rememberedExecution.set(result.execution_id);
        } catch (err) { failed(err); } finally { starting.current = false; setBusy(false); }
    };
    return <main className="bcra-page">
        <nav><a href="/">← Herramientas</a><span>Celesol · Contabilidad</span></nav>
        <header className="bcra-heading"><div><p className="section__eyebrow">Central de Deudores · PNFC</p>
            <h1>Generar archivo BCRA</h1><p>Elegí el período y las líneas. Cada corrida conserva su configuración y sus archivos de control.</p></div>
            <img src="/brand/red-unisol-logo.png" alt="Red Unisol" /></header>
        {!authenticated ? <section className="panel"><h2>Acceso interno</h2>
            {config.accessConfigured ? <PadronesLogin onLogin={() => setAuthenticated(true)} /> : <p>El acceso todavía no está configurado.</p>}
        </section> : <>
            {!config.configured && <p className="bcra-alert" role="alert">La conexión con Kestra todavía no está configurada. Podés revisar las líneas; la generación se habilitará cuando esté disponible.</p>}
            {error && <p className="bcra-alert" role="alert">{error}</p>}
            {!catalog && <button disabled={busy} onClick={load}>{busy ? 'Consultando líneas…' : 'Volver a consultar líneas'}</button>}
            {catalog && <form onSubmit={submit} className="bcra-workspace">
                <section className="panel bcra-fields"><div className="bcra-row"><h2>1. Presentación</h2><span className="bcra-badge">Celesol</span></div>
                    <div className="bcra-form-grid">
                        <label>Período<input aria-label="Período" type="month" required max={config.latestClosedMonth} value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
                        <label>Preparado por<input required maxLength={80} value={declaredBy} placeholder="Tefi, Pato…" onChange={(e) => setDeclaredBy(e.target.value)} /></label>
                        <label>Presentación<select value={presentation} onChange={(e) => setPresentation(e.target.value)}><option>NORMAL</option><option>RECTIFICATIVA</option></select></label>
                        <label>TNA promedio sin IVA (%)<input aria-label="TNA promedio" required={granted} disabled={!granted} inputMode="decimal" placeholder="Ej. 112,00" pattern="[0-9]{1,3},[0-9]{2}" value={granted ? rate : '000,00'} onChange={(e) => setRate(e.target.value)} /></label>
                    </div>
                    <label className="bcra-check"><input type="checkbox" checked={granted} onChange={(e) => setGranted(e.target.checked)} />Hubo préstamos sin garantía real otorgados en el mes</label>
                    <p className="bcra-basis"><strong>Datos de cada corrida:</strong> saldos vigentes de Vimarx al generar. El período fija el corte de mora y excluye préstamos emitidos después de ese mes. Este motor no reconstruye saldos históricos al cierre.</p>
                </section>
                <section className="panel bcra-lines"><div className="bcra-row"><div><h2>2. Líneas a informar</h2><p>{number(selected.length)} de {number(catalog.lines.length)} seleccionadas · Reglas iniciales: julio 2026 v2</p></div>
                    <button type="button" disabled={busy || active} onClick={() => restore()}>Restaurar reglas de julio</button></div>
                    <label>Buscar línea o superior<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej. Mudon, CUAD, Médica…" /></label>
                    <div className="bcra-line-list">{groups.map((group) => {
                        const search = searchText(query);
                        const visible = group.lines.filter((line) => searchText(`${line.superior_name} ${line.name}`).includes(search));
                        if (!visible.length) return null;
                        return <details key={group.id} open={query ? true : undefined} className="bcra-line-group">
                            <summary><span onClick={(e) => e.stopPropagation()}><GroupCheck lines={group.lines} selected={selected} disabled={busy || active} onChange={(included) => toggle(group.lines.map((line) => line.id), included)} /></span>
                                <strong>{group.name}</strong><span>{group.lines.filter((line) => selected.includes(line.id)).length}/{group.lines.length}</span></summary>
                            <div>{visible.map((line) => <label className="bcra-check" key={line.id}><input type="checkbox" disabled={busy || active} checked={selected.includes(line.id)} onChange={(e) => toggle([line.id], e.target.checked)} />{line.name}<small>#{line.id}</small></label>)}</div>
                        </details>;
                    })}</div>
                </section>
                <section className="panel bcra-exclusions"><h2>3. Exclusiones y reglas de mora</h2><p>Una exclusión por renglón: <strong>valor; motivo</strong>. El motivo queda guardado con la corrida.</p>
                    <div className="bcra-form-grid"><label>CUIT excluidos<textarea aria-label="CUIT excluidos" rows={5} value={cuits} onChange={(e) => setCuits(e.target.value)} placeholder="CUIT de 11 dígitos; motivo" /></label>
                        <label>Números de préstamo excluidos<textarea aria-label="Préstamos excluidos" rows={5} value={accounts} onChange={(e) => setAccounts(e.target.value)} placeholder="Número de cuenta; motivo" /></label></div>
                    <details><summary>Superiores con situación 1 hasta 66 días</summary><p>Por defecto: Haberes Descuento Policía CBA. Los demás mantienen la clasificación del generador.</p>
                        <div className="bcra-special">{groups.map((group) => <label className="bcra-check" key={group.id}><input type="checkbox" checked={special.includes(group.id)} onChange={(e) => setSpecial((ids) => e.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id))} />{group.name}</label>)}</div>
                    </details>
                </section>
                <div className="bcra-submit"><p>La deuda mínima de $25.000 se evalúa por socio, sumando sus préstamos incluidos.</p>
                    <button className="bcra-primary" disabled={busy || active || !selected.length || !config.configured}>{busy ? 'Iniciando…' : active ? 'Generación en curso…' : 'Generar presentación →'}</button></div>
            </form>}
            {pollError && <p role="status">{pollError}</p>}
            {current && <RunResult run={current} />}
            <section className="panel bcra-history"><div className="bcra-row"><h2>Historial de corridas</h2><button type="button" onClick={async () => { try { setHistory((await padronesApi('/api/bcra/runs')).runs); } catch (err) { failed(err); } }}>Actualizar historial</button></div>
                {!history.length ? <p>Todavía no hay corridas registradas.</p> : <div className="bcra-history-table"><table><thead><tr><th>Período</th><th>Generación</th><th>Preparado por</th><th>Estado</th><th>Socios</th><th>Archivos</th></tr></thead><tbody>
                    {history.map((run) => <tr key={run.metadata.run_id}><td>{run.metadata.period}</td><td>{date(run.metadata.started_at)}</td><td>{run.metadata.declared_by}</td><td>{labels[run.metadata.status] || run.metadata.status}{run.metadata.status === 'RUNNING' && run.metadata.execution_id && <button type="button" onClick={async () => { try { setCurrent(await padronesApi(`/api/bcra/executions/${encodeURIComponent(run.metadata.execution_id)}`)); setPolling((n) => n + 1); } catch (err) { failed(err); } }}>Ver estado</button>}</td><td>{run.metadata.debtors === undefined ? '—' : number(run.metadata.debtors)}</td><td><Downloads downloads={run.downloads} /></td></tr>)}
                </tbody></table></div>}
            </section>
        </>}
    </main>;
}
