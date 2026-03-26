import React from 'react';
import { createRoot } from 'react-dom/client';
import '../css/app.css';

const rootElement = document.getElementById('app');

const initialPayload = rootElement?.dataset.payload ? JSON.parse(rootElement.dataset.payload) : { branding: {}, tools: [] };

const currencyFormatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
});

const icons = {
    'credit-path': (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path d="M5 8.5H23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <rect x="4" y="6" width="20" height="16" rx="4" stroke="currentColor" strokeWidth="2" />
            <path d="M8 17H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M18 15.5L20 17.5L24 13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    plus: (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="20" height="20" rx="6" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M14 9V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M9 14H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    ),
};

const placeholderTool = {
    id: 'proxima-herramienta',
    title: 'Proxima herramienta',
    category: 'Alta manual',
    status: 'soon',
    icon: 'plus',
    actionLabel: 'Proximamente',
    isPlaceholder: true,
};

function App({ branding, tools }) {
    const [selectedToolId, setSelectedToolId] = React.useState(null);
    const [cuil, setCuil] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState('');

    const selectedTool = tools.find((tool) => tool.id === selectedToolId) ?? null;
    const catalog = [...tools, placeholderTool];

    const openTool = (tool) => {
        if (tool.isPlaceholder || tool.status !== 'active') {
            return;
        }

        setSelectedToolId(tool.id);
        setError('');
        setResult(null);
    };

    const closeTool = () => {
        setSelectedToolId(null);
        setError('');
        setResult(null);
    };

    const clearToolState = () => {
        setCuil('');
        setError('');
        setResult(null);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!selectedTool?.endpoint) {
            setError('La herramienta todavia no tiene un endpoint configurado.');
            return;
        }

        setLoading(true);
        setError('');
        setResult(null);

        try {
            const response = await fetch(selectedTool.endpoint, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ cuil }),
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(payload.message ?? 'La consulta no pudo completarse.');
            }

            setResult(payload);
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setLoading(false);
        }
    };

    const resultTone = getResultTone(result, error);

    return (
        <div className="shell">
            <section className="hero">
                <div className="hero__topbar">
                    <div className="brand">
                        <div className="brand__mark">RU</div>
                        <div>
                            <p className="brand__eyebrow">{branding.eyebrow}</p>
                            <p className="brand__title">{branding.title}</p>
                        </div>
                    </div>
                    <a className="hero__cta" href={branding.support_url} target="_blank" rel="noreferrer">
                        {branding.support_label}
                    </a>
                </div>

                <div className="hero__summary">
                    <p className="hero__eyebrow">Herramientas</p>
                    <h1 className="hero__title">{branding.title}</h1>
                </div>
            </section>

            <section className="panel catalog">
                <div className="catalog__grid">
                    {catalog.map((tool) => {
                        const isSelected = selectedTool?.id === tool.id;
                        const isPlaceholder = tool.isPlaceholder || tool.status !== 'active';

                        return (
                            <article
                                className={`tool-card ${isSelected ? 'tool-card--selected' : ''} ${isPlaceholder ? 'tool-card--muted' : 'tool-card--active'}`}
                                key={tool.id}
                            >
                                <div className="tool-card__icon">{icons[tool.icon] ?? icons.plus}</div>

                                <div className="tool-card__body">
                                    <h2 className="tool-card__title">{tool.title}</h2>
                                    <p className="tool-card__category">{tool.category}</p>
                                </div>

                                <div className="tool-card__footer">
                                    <span className={`status-chip ${isPlaceholder ? 'status-chip--soon' : 'status-chip--live'}`}>
                                        {isPlaceholder ? 'Proximamente' : 'Activo'}
                                    </span>
                                    <button
                                        className={`button ${isPlaceholder ? 'button--ghost' : 'button--primary'} button--small`}
                                        type="button"
                                        disabled={isPlaceholder}
                                        onClick={() => openTool(tool)}
                                    >
                                        {isPlaceholder ? 'Proximamente' : 'Usar'}
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>

            {selectedTool && (
                <section className="panel workspace">
                    <div className="workspace__header">
                        <div>
                            <p className="section__eyebrow">{selectedTool.category}</p>
                            <h2 className="workspace__title">{selectedTool.title}</h2>
                        </div>
                        <button className="button button--ghost button--small" type="button" onClick={closeTool}>
                            Cerrar
                        </button>
                    </div>

                    <form className="workspace__form" onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="cuil">CUIL</label>
                            <input
                                id="cuil"
                                name="cuil"
                                placeholder="20-12345678-3"
                                value={cuil}
                                onChange={(event) => setCuil(event.target.value)}
                                autoComplete="off"
                            />
                        </div>

                        <div className="actions">
                            <button className="button button--primary" disabled={loading} type="submit">
                                {loading ? 'Consultando...' : selectedTool.actionLabel ?? 'Consultar'}
                            </button>
                            <button className="button button--ghost" type="button" onClick={clearToolState}>
                                Limpiar
                            </button>
                        </div>
                    </form>

                    {(error || result) && (
                        <section className={`result result--${resultTone}`}>
                            <h3 className="result__headline">{getResultHeadline(result, error)}</h3>
                            <p className="result__copy">{getResultCopy(result, error)}</p>

                            {result && (
                                <div className="result__grid">
                                    <div className="result__metric">
                                        <span>CUIL</span>
                                        <strong>{result.cuil || 'Sin dato'}</strong>
                                    </div>
                                    <div className="result__metric">
                                        <span>Saldo</span>
                                        <strong>{typeof result.saldo_renovacion === 'number' ? currencyFormatter.format(result.saldo_renovacion) : 'No informado'}</strong>
                                    </div>
                                    <div className="result__metric">
                                        <span>Renovacion</span>
                                        <strong>{result.puede_renovar ? 'Si' : 'No'}</strong>
                                    </div>
                                    <div className="result__metric">
                                        <span>Motivo</span>
                                        <strong>{humanizeReason(result.motivo || result.error || 'Sin detalle')}</strong>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </section>
            )}
        </div>
    );
}

function getResultTone(result, error) {
    if (error || (result && result.ok === false)) {
        return 'error';
    }

    if (result && result.puede_renovar) {
        return 'success';
    }

    return 'warning';
}

function getResultHeadline(result, error) {
    if (error) {
        return 'No se pudo completar la consulta';
    }

    if (!result) {
        return '';
    }

    if (result.ok && result.puede_renovar) {
        return 'Puede renovar';
    }

    if (result.ok) {
        return 'No puede renovar';
    }

    return 'Respuesta de validacion';
}

function getResultCopy(result, error) {
    if (error) {
        return error;
    }

    if (!result) {
        return '';
    }

    if (result.ok && result.puede_renovar) {
        return 'Consulta completada correctamente.';
    }

    if (result.ok) {
        return humanizeReason(result.motivo || 'sin detalle');
    }

    return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
}

function humanizeReason(value) {
    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

if (rootElement) {
    createRoot(rootElement).render(<App branding={initialPayload.branding || {}} tools={initialPayload.tools || []} />);
}