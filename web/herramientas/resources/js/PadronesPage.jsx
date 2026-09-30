import React from 'react';
import '../css/padrones.css';

export async function padronesApi(url, options = {}) {
    const multipart = options.body instanceof FormData;
    const response = await fetch(url, {
        credentials: 'same-origin', cache: 'no-store', ...options,
        headers: { Accept: 'application/json', ...(!multipart && { 'Content-Type': 'application/json' }),
            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || '', ...options.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(Object.values(body.errors || {}).flat()[0] || body.message || 'No se pudo completar la operación. Volvé a intentar.');
        error.status = response.status;
        throw error;
    }
    return body;
}
const post = (url, body) => padronesApi(url, { method: 'POST', body: JSON.stringify(body) });
const date = (value) => new Date(value).toLocaleString('es-AR');

export function PadronesLogin({ onLogin }) {
    const [password, setPassword] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    return <form className="padrones-login" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { await post('/padrones/login', { password }); setPassword(''); onLogin(); }
        catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
        <label>Contraseña de Análisis<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        {error && <p role="alert">{error}</p>}
    </form>;
}

export function PadronesResults({ document, requestKey }) {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState('');
    const [login, setLogin] = React.useState(false);
    const [retry, setRetry] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
        setData(null); setError(''); setLogin(false);
        if (!document) return;
        const controller = new AbortController(); setBusy(true);
        padronesApi('/api/padrones/lookup', { method: 'POST', body: JSON.stringify({ document }), signal: controller.signal })
            .then(setData).catch((err) => {
                if (err.name === 'AbortError') return;
                if (err.status === 401) setLogin(true);
                else setError(err.status === 419 ? 'La sesión venció. Recargá la página.' : err.message);
            }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
        return () => controller.abort();
    }, [document, requestKey, retry]);
    if (!document) return null;
    return <section className="panel padrones-results">
        <div className="padrones-heading"><div><p className="section__eyebrow">Información complementaria</p><h2>Padrones</h2></div><a href="/padrones">Administrar padrones</a></div>
        <p className="padrones-query">Documento: <strong>{document}</strong></p>
        {busy && <p role="status">Buscando coincidencias…</p>}
        {login && <><p>Ingresá con el acceso de Análisis para consultar los padrones.</p><PadronesLogin onLogin={() => setRetry((n) => n + 1)} /></>}
        {error && <p role="alert">{error} <button onClick={() => setRetry((n) => n + 1)}>Reintentar</button></p>}
        {data?.sources?.length === 0 && <p>Todavía no hay padrones publicados.</p>}
        {data?.sources?.map((source) => <article className={`padron-match ${source.kind === 'bajas' && source.matches.length ? 'padron-match--bajas' : ''}`} key={source.id}>
            <div className="padron-match__heading">
                <h3>{source.name} · {source.period}</h3>
                <span>{source.matches.length ? `${source.matches.length} coincidencia${source.matches.length !== 1 ? 's' : ''}` : 'Sin coincidencias'}</span>
                <small>Cargado el {date(source.loaded_at)}</small>
            </div>
            {source.matches.length > 0 && <>
                {source.kind === 'bajas' && <p><strong>Figura en el archivo de bajas.</strong> Revisá la fecha y la causa junto con los demás padrones.</p>}
                <DataTable rows={source.matches.map((m) => m.data)} />
            </>}
        </article>)}
        <p className="padrones-note">No aparecer en un padrón no demuestra ausencia de empleo. Estas fuentes no modifican el informe de CredixSA ni determinan una decisión crediticia.</p>
    </section>;
}

function DataTable({ rows }) {
    if (!rows?.length) return null;
    const headers = Object.keys(rows[0]);
    return <div className="padrones-table"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{headers.map((h) => <td key={h}>{row[h] || '—'}</td>)}</tr>)}</tbody></table></div>;
}

export default function PadronesPage({ config }) {
    const [authenticated, setAuthenticated] = React.useState(config.authenticated);
    const [sources, setSources] = React.useState([]);
    const [selected, setSelected] = React.useState('');
    const [upload, setUpload] = React.useState(null);
    const [mapping, setMapping] = React.useState(null);
    const [preview, setPreview] = React.useState(null);
    const [ack, setAck] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [newSource, setNewSource] = React.useState(false);
    const [restore, setRestore] = React.useState(null);
    const source = sources.find((s) => s.id === selected);
    const reload = async () => { const r = await padronesApi('/api/padrones/sources'); setSources(r.sources); };
    const run = async (action) => {
        setBusy(true); setError(''); setNotice('');
        try { await action(); } catch (err) {
            if (err.status === 401) { setAuthenticated(false); setSources([]); setUpload(null); setPreview(null); }
            setError(err.status === 419 ? 'La sesión venció. Recargá la página para continuar.' : err.message);
        } finally { setBusy(false); }
    };
    React.useEffect(() => { if (authenticated) run(reload); }, [authenticated]);
    const reset = () => { setUpload(null); setMapping(null); setPreview(null); setAck(false); setRestore(null); };
    const choose = (id) => { setSelected(id); reset(); setError(''); setNotice(''); };
    const configure = (result) => {
        setUpload(result); setPreview(null); setAck(false);
        const saved = result.mapping;
        const sheet = result.sheets.find((s) => s.name === saved?.sheet) || result.sheets[0];
        const row = saved?.header_row || 1;
        const headers = sheet?.rows.find((r) => r.number === row)?.values || [];
        setMapping({ sheet: sheet?.name || '', header_row: row, document_column: saved?.document_column ?? 0,
            columns: saved?.columns?.filter((i) => i < headers.length && headers[i]) || headers.map((_, i) => i).filter((i) => headers[i]) });
    };
    const change = (patch) => { setMapping((m) => ({ ...m, ...patch })); setPreview(null); setAck(false); };
    const currentSheet = upload?.sheets.find((s) => s.name === mapping?.sheet);
    const headers = currentSheet?.rows.find((r) => r.number === mapping?.header_row)?.values || [];
    const endpoint = `/api/padrones/sources/${selected}/versions`;
    const activate = (version, acknowledged) => run(async () => {
        await post(`${endpoint}/${version}/activate`, { expected_version: source.active_version, acknowledged });
        reset(); await reload(); setNotice('Versión publicada. Las nuevas consultas ya usan estos datos.');
    });
    return <main className="padrones-page">
        <nav><a href="/">Herramientas</a><a href="/credixsa">Consulta CredixSA</a><a href="/analisis">Bandeja de análisis</a></nav>
        <header><p className="section__eyebrow">Análisis · Fuentes de consulta</p><h1>Administrar padrones</h1><p>Cargá nuevas versiones, revisá sus datos y elegí cuándo publicarlas.</p></header>
        {!authenticated ? <section className="panel"><h2>Acceso de Análisis</h2>{config.configured ? <PadronesLogin onLogin={() => setAuthenticated(true)} /> : <p>El acceso todavía no está configurado.</p>}</section> : <>
            <div className="padrones-heading"><p>Excel XLSX o CSV · Hasta 20 MB y 100.000 filas por archivo.</p><button disabled={busy} onClick={() => setNewSource(!newSource)}>Nueva fuente</button></div>
            {newSource && <form className="panel padrones-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => {
                const r = await post('/api/padrones/sources', Object.fromEntries(f)); await reload(); choose(r.id); setNewSource(false);
            }); }}>
                <h2>Nueva fuente</h2><label>Nombre<input name="name" maxLength={100} required /></label><label>Descripción<input name="description" maxLength={500} /></label>
                <label>Tipo<select name="kind"><option value="padron">Padrón informativo</option><option value="bajas">Bajas de agentes</option></select></label><button disabled={busy}>Crear fuente</button>
            </form>}
            <div className="padrones-grid">{sources.map((s) => {
                const active = s.versions.find((v) => v.id === s.active_version);
                return <button disabled={busy} className={`padrones-card ${selected === s.id ? 'is-selected' : ''}`} key={s.id} onClick={() => choose(s.id)}>
                    <strong>{s.name}</strong><span>{s.description}</span><span>{active ? `Vigente: ${active.period} · ${active.summary.valid.toLocaleString('es-AR')} registros` : 'Sin versión publicada'}</span><b>Cargar versión / Ver historial →</b>
                </button>;
            })}</div>
            {source && <section className="panel padrones-workspace" aria-busy={busy}>
                <h2>{source.name}</h2>
                <form key={source.id} className="padrones-form" onSubmit={(e) => { e.preventDefault(); const body = new FormData(e.currentTarget); run(async () => { configure(await padronesApi(endpoint, { method: 'POST', body })); await reload(); }); }}>
                    <h3>1. Cargar nueva versión</h3><label>Período de los datos<input name="period" type="month" required /></label>
                    <label>Archivo Excel o CSV<input name="file" type="file" accept=".xlsx,.csv" required /></label><button disabled={busy}>Subir y revisar</button>
                </form>
                {upload && mapping && <div className="padrones-form">
                    <h3>2. Revisar estructura</h3><p>Confirmá la columna DNI/CUIL y los campos que se mostrarán en las consultas.</p>
                    <label>Hoja<select disabled={busy} value={mapping.sheet} onChange={(e) => change({ sheet: e.target.value, columns: [], document_column: 0 })}>{upload.sheets.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
                    <label>Fila de encabezados<select disabled={busy} value={mapping.header_row} onChange={(e) => change({ header_row: Number(e.target.value), columns: [] })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
                    <label>Columna DNI/CUIL<select disabled={busy} value={mapping.document_column} onChange={(e) => change({ document_column: Number(e.target.value) })}>{headers.map((h, i) => h && <option key={i} value={i}>{h} (columna {i + 1})</option>)}</select></label>
                    <fieldset disabled={busy}><legend>Campos visibles</legend>{headers.map((h, i) => h && <label className="padrones-check" key={i}><input type="checkbox" checked={mapping.columns.includes(i)} onChange={(e) => change({ columns: e.target.checked ? [...mapping.columns, i].sort((a, b) => a - b) : mapping.columns.filter((n) => n !== i) })} />{h}</label>)}</fieldset>
                    <h4>Primeras filas de la hoja</h4><DataTable rows={(currentSheet?.rows || []).filter((r) => r.number > mapping.header_row).slice(0, 3).map((r) => Object.fromEntries(headers.map((h, i) => [h || `Columna ${i + 1}`, r.values[i] || ''])))} />
                    <button disabled={busy || !mapping.columns.length} onClick={() => run(async () => { setPreview(await post(`${endpoint}/${upload.version}/prepare`, mapping)); await reload(); })}>Validar archivo</button>
                </div>}
                {preview && <div className="padrones-preview">
                    <h3>3. Confirmar publicación</h3><p>{preview.summary.valid.toLocaleString('es-AR')} registros válidos · {preview.summary.invalid} filas excluidas por documento inválido · {preview.summary.multiple_documents} documentos con varias coincidencias.</p>
                    <p>Versión anterior: {preview.summary.previous_records.toLocaleString('es-AR')} registros. Se agregan {preview.summary.added_documents} documentos y desaparecen {preview.summary.removed_documents}.</p>
                    {preview.summary.structure_changed && <p role="alert">La estructura o los campos seleccionados cambiaron respecto de la configuración anterior.</p>}
                    {preview.summary.issues.map((x) => <p key={x.row}>Fila {x.row}: {x.message}</p>)}
                    <DataTable rows={preview.summary.sample.map((r) => r.data)} />
                    <label className="padrones-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Revisé el período, los datos y las advertencias. Publicar reemplazará la versión vigente de esta fuente.</label>
                    <button disabled={busy || !ack} onClick={() => activate(upload.version, ack)}>Publicar versión</button>
                </div>}
                <h3>Historial de versiones</h3>
                {!source.versions.length && <p>Aún no se cargaron archivos.</p>}
                {source.versions.map((v) => <div className="padrones-version" key={v.id}><div><strong>{v.period} · {v.filename}</strong><small>{date(v.created_at)} · {v.summary ? `${v.summary.valid} registros` : 'Pendiente de validar'} · {v.id === source.active_version ? 'Vigente' : v.state === 'published' ? 'Publicada anteriormente' : 'Borrador'}</small></div>
                    {v.id !== source.active_version && (v.state === 'published' ? <button disabled={busy} onClick={() => setRestore(v)}>Restaurar</button> : <button disabled={busy} onClick={() => run(async () => configure(await padronesApi(`${endpoint}/${v.id}`)))}>Revisar</button>)}
                </div>)}
                {restore && <div className="padrones-preview"><p>¿Usar nuevamente <strong>{restore.filename} ({restore.period})</strong>? Reemplazará la versión vigente y conservará el historial.</p><button disabled={busy} onClick={() => activate(restore.id, true)}>Confirmar restauración</button><button disabled={busy} onClick={() => setRestore(null)}>Cancelar</button></div>}
            </section>}
        </>}
        {busy && <p role="status">Procesando… La versión vigente sigue disponible.</p>}
        {error && <p className="padrones-feedback padrones-feedback--error" role="alert">{error}</p>}
        {notice && <p className="padrones-feedback" role="status">{notice}</p>}
    </main>;
}
