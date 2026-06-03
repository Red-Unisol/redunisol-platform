import React from 'react';
import { createRoot } from 'react-dom/client';
import '../css/app.css';

const rootElement = document.getElementById('app');
const brandMarkUrl = '/brand/red-unisol-mark.png';
const brandLogoUrl = '/brand/red-unisol-logo.png';

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
    const [formValues, setFormValues] = React.useState({
        cuil: '',
        cuit: '',
        nombre: '',
        identificador: '',
    });
    const [loading, setLoading] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState('');

    const selectedTool = tools.find((tool) => tool.id === selectedToolId) ?? null;
    const catalog = [...tools, placeholderTool];
    const credixNormalized = selectedTool?.id === 'consulta-quiebra-credix'
        ? parseJsonObject(result?.normalized_json)
        : null;

    const openTool = (tool) => {
        if (tool.isPlaceholder || tool.status !== 'active') {
            return;
        }

        if (tool.id === 'consulta-quiebra-credix') {
            window.location.assign(tool.href || '/credixsa');
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
        setFormValues({
            cuil: '',
            cuit: '',
            nombre: '',
            identificador: '',
        });
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
            const requestBody = buildRequestBody(selectedTool?.id, formValues);
            const response = await fetch(selectedTool.endpoint, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(extractErrorMessage(payload));
            }

            setResult(payload);
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setLoading(false);
        }
    };

    const resultTone = getResultTone(selectedTool?.id, result, error);

    return (
        <div className="shell">
            <section className="hero">
                <div className="hero__topbar">
                    <div className="brand brand--stacked">
                        <img className="brand__logo" src={brandLogoUrl} alt="Red Unisol" />
                        <div className="brand__copy">
                            <p className="brand__eyebrow">{branding.eyebrow}</p>
                            <p className="brand__title">{branding.title}</p>
                        </div>
                    </div>
                </div>

                <div className="hero__summary">
                    <h1 className="hero__title">Consultas internas listas para usar</h1>
                    <p className="hero__description">{branding.description}</p>
                </div>
            </section>

            <section className="panel catalog">
                <div className="catalog__header">
                    <div>
                        <p className="section__eyebrow">Catalogo</p>
                        <h2 className="catalog__title">Elije la herramienta que quieras utilizar</h2>
                    </div>
                </div>
                <div className="catalog__grid">
                    {catalog.map((tool) => {
                        const isSelected = selectedTool?.id === tool.id;
                        const isPlaceholder = tool.isPlaceholder || tool.status !== 'active';

                        return (
                            <button
                                className={`tool-card ${isSelected ? 'tool-card--selected' : ''} ${isPlaceholder ? 'tool-card--muted' : 'tool-card--active'}`}
                                key={tool.id}
                                type="button"
                                disabled={isPlaceholder}
                                onClick={() => openTool(tool)}
                            >
                                <div className="tool-card__icon">{icons[tool.icon] ?? icons.plus}</div>

                                <div className="tool-card__body">
                                    <h2 className="tool-card__title">{tool.title}</h2>
                                    <p className="tool-card__description">{tool.description}</p>
                                    <p className="tool-card__category">{tool.category}</p>
                                </div>

                                <div className="tool-card__footer">
                                    <span className={`status-chip ${isPlaceholder ? 'status-chip--soon' : 'status-chip--live'}`}>
                                        {isPlaceholder ? 'Proximamente' : 'Activo'}
                                    </span>
                                    <span className="tool-card__action">
                                        {isPlaceholder ? 'Proximamente' : 'Abrir'}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>

            {selectedTool && (
                <div className="modal-layer" role="presentation" onClick={closeTool}>
                    <section
                        className="panel workspace workspace--modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="workspace-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="workspace__brand">
                            <img className="workspace__logo" src={brandLogoUrl} alt="Red Unisol" />
                        </div>
                        <div className="workspace__header">
                            <div>
                                <div className="workspace__chip">
                                    <img className="workspace__chipIcon" src={brandMarkUrl} alt="" aria-hidden="true" />
                                    <span>{selectedTool.title}</span>
                                </div>
                                <h2 className="workspace__title" id="workspace-title">{selectedTool.title}</h2>
                                <p className="workspace__description">{selectedTool.description}</p>
                            </div>
                            <button className="button button--ghost button--small" type="button" onClick={closeTool}>
                                Cerrar
                            </button>
                        </div>

                        <form className="workspace__form" onSubmit={handleSubmit}>
                            {selectedTool?.id === 'consulta-quiebra-credix' ? (
                                <div className="form-grid">
                                <div className="field">
                                    <label htmlFor="cuit">CUIL o DNI</label>
                                    <input
                                            id="cuit"
                                            name="cuit"
                                            placeholder="20-12345678-3 o 12345678"
                                            value={formValues.cuit}
                                            onChange={(event) =>
                                                setFormValues((current) => ({
                                                    ...current,
                                                    cuit: event.target.value,
                                                }))
                                        }
                                        autoComplete="off"
                                    />
                                    <p className="field__hint">Podes escribirlo con o sin guiones.</p>
                                </div>

                                <div className="field">
                                        <label htmlFor="nombre">Nombre</label>
                                        <input
                                            id="nombre"
                                            name="nombre"
                                            placeholder="Apellido y nombre"
                                            value={formValues.nombre}
                                            onChange={(event) =>
                                                setFormValues((current) => ({
                                                    ...current,
                                                    nombre: event.target.value,
                                            }))
                                        }
                                        autoComplete="off"
                                    />
                                    <p className="field__hint">Nombre completo del beneficiario.</p>
                                </div>
                            </div>
                        ) : selectedTool?.id === 'consulta-empleador' ? (
                                <div className="field">
                                    <label htmlFor="identificador">CUIL o DNI</label>
                                    <input
                                        id="identificador"
                                        name="identificador"
                                        placeholder="Ingresa el CUIL o DNI"
                                        value={formValues.identificador}
                                        onChange={(event) =>
                                            setFormValues((current) => ({
                                                ...current,
                                                identificador: event.target.value,
                                            }))
                                        }
                                        autoComplete="off"
                                    />
                                    <p className="field__hint">Ingresa el CUIL o DNI del beneficiario con o sin guiones.</p>
                                </div>
                        ) : (
                            <div className="field">
                                    <label htmlFor="cuil">CUIL</label>
                                    <input
                                        id="cuil"
                                        name="cuil"
                                        placeholder="20-12345678-3"
                                        value={formValues.cuil}
                                        onChange={(event) =>
                                            setFormValues((current) => ({
                                                ...current,
                                                cuil: event.target.value,
                                            }))
                                        }
                                        autoComplete="off"
                                    />
                                    <p className="field__hint">Escribilo con o sin guiones. Se limpia automaticamente.</p>
                                </div>
                            )}

                            <div className="actions">
                                <button className="button button--primary" disabled={loading} type="submit">
                                    {loading ? 'Consultando...' : selectedTool.actionLabel ?? 'Consultar'}
                                </button>
                                <button className="button button--ghost" type="button" onClick={clearToolState}>
                                    Limpiar
                                </button>
                            </div>
                        </form>

                        {loading && selectedTool && (
                            <section className="loading-state" role="status" aria-live="polite">
                                <div className="loading-state__spinner" aria-hidden="true" />
                                <div className="loading-state__body">
                                    <h3 className="loading-state__headline">{getLoadingHeadline(selectedTool)}</h3>
                                    <p className="loading-state__copy">{getLoadingCopy(selectedTool?.id)}</p>
                                </div>
                            </section>
                        )}

                        {(error || result) && (
                            <section className={`result result--${resultTone}`}>
                                <h3 className="result__headline">{getResultHeadline(selectedTool?.id, result, error)}</h3>
                                <p className="result__copy">{getResultCopy(selectedTool?.id, result, error)}</p>

                                {result && (
                                    <div className="result__grid">
                                        {selectedTool?.id === 'consulta-renovacion-cruz-del-eje' && (
                                            <>
                                                <div className="result__metric">
                                                    <span>CUIL</span>
                                                    <strong>{result.cuil || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Saldo</span>
                                                    <strong>
                                                        {typeof result.saldo_renovacion === 'number'
                                                            ? currencyFormatter.format(result.saldo_renovacion)
                                                            : 'No informado'}
                                                    </strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Renovacion</span>
                                                    <strong>{result.puede_renovar ? 'Si' : 'No'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Motivo</span>
                                                    <strong>{humanizeReason(result.motivo || result.error || 'Sin detalle')}</strong>
                                                </div>
                                            </>
                                        )}

                                        {selectedTool?.id === 'consulta-tope-descuento-caja' && (
                                            <>
                                                <div className="result__metric">
                                                    <span>CUIL</span>
                                                    <strong>{result.cuil || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Nombre</span>
                                                    <strong>{result.nombre || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Apellido</span>
                                                    <strong>{result.apellido || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Disponible</span>
                                                    <strong>
                                                        {typeof result.disponible === 'number'
                                                            ? currencyFormatter.format(result.disponible)
                                                            : 'No informado'}
                                                    </strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Tope descuento</span>
                                                    <strong>
                                                        {typeof result.tope_descuento === 'number'
                                                            ? currencyFormatter.format(result.tope_descuento)
                                                            : 'No informado'}
                                                    </strong>
                                                </div>
                                            </>
                                        )}

                                        {selectedTool?.id === 'consulta-quiebra-credix' && (
                                            <>
                                                <div className="result__metric">
                                                    <span>CUIL o DNI</span>
                                                    <strong>{result.cuit || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Nombre</span>
                                                    <strong>{result.nombre || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Registros</span>
                                                    <strong>{getQuiebraRecordCount(result)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Cache</span>
                                                    <strong>{result.cache_hit ? 'Si' : 'No'}</strong>
                                                </div>
                                            </>
                                        )}

                                        {selectedTool?.id === 'consulta-empleador' && (
                                            <>
                                                <div className="result__metric">
                                                    <span>Identificador</span>
                                                    <strong>{result.identifier || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Tipo</span>
                                                    <strong>{result.tipo || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Persona</span>
                                                    <strong>{getEmpleadorField(result, 'apenom') || getEmpleadorField(result, 'nombre') || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>CUIL</span>
                                                    <strong>{getEmpleadorField(result, 'cuil') || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Empleador</span>
                                                    <strong>{getEmpleadorField(result, 'razon_social_empleador') || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>CUIT empleador</span>
                                                    <strong>{getEmpleadorField(result, 'cuit_empleador') || 'Sin dato'}</strong>
                                                </div>
                                            </>
                                        )}

                                        {selectedTool?.id === 'consulta-cuad' && (
                                            <>
                                                <div className="result__metric">
                                                    <span>CUIL</span>
                                                    <strong>{result.cuil || 'Sin dato'}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Bruto</span>
                                                    <strong>{formatCurrencyValue(result.bruto)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Neto</span>
                                                    <strong>{formatCurrencyValue(result.neto)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Cupo</span>
                                                    <strong>{formatCurrencyValue(result.cupo)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Afectado</span>
                                                    <strong>{formatCurrencyValue(result.afectado)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Disponible</span>
                                                    <strong>{formatCurrencyValue(result.disponible)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Deuda</span>
                                                    <strong>{formatCurrencyValue(result.deuda)}</strong>
                                                </div>
                                                <div className="result__metric">
                                                    <span>Intentos captcha</span>
                                                    <strong>{result.captcha_attempts ?? 'Sin dato'}</strong>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {selectedTool?.id === 'consulta-quiebra-credix' && result && (
                                    <div className="result__detail">
                                        {result.status === 'multiple' && (
                                            <div className="result__stack">
                                                <h4 className="result__subheading">Coincidencias encontradas</h4>
                                                <div className="result__list">
                                                    {parseJsonArray(result.rows_json).map((row, index) => (
                                                        <article className="result__listItem" key={`${row.cuit || 'row'}-${index}`}>
                                                            <strong>{row.nombre || 'Sin nombre'}</strong>
                                                            <span>CUIT: {row.cuit || 'Sin dato'}</span>
                                                            <span>Documento: {row.documento || 'Sin dato'}</span>
                                                        </article>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {result.status === 'single' && (
                                            <div className="result__stack">
                                                <h4 className="result__subheading">Informe CredixSA</h4>
                                                {credixNormalized && <CredixNormalizedSummary normalized={credixNormalized} />}
                                                {parseJsonArray(result.data_json).length > 0 ? (
                                                    <CredixReportSections sections={parseJsonArray(result.data_json)} />
                                                ) : (
                                                    <p className="result__empty">No hay secciones disponibles en el informe.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

function CredixReportSections({ sections }) {
    return (
        <div className="result__stack">
            {sections.map((section, index) => (
                <article className="result__listItem" key={`${section.title || 'section'}-${section.index ?? index}`}>
                    <strong>{section.title || `Seccion ${index + 1}`}</strong>
                    {section.source && <span>Fuente: {section.source}</span>}
                    <CredixSectionTable section={section} />
                </article>
            ))}
        </div>
    );
}

function CredixsaPage({ branding, tool }) {
    const [formValues, setFormValues] = React.useState({ cuit: '', nombre: '' });
    const [loading, setLoading] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState('');
    const normalized = parseJsonObject(result?.normalized_json);
    const resultTone = getResultTone('consulta-quiebra-credix', result, error);

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!tool?.endpoint) {
            setError('La herramienta todavia no tiene un endpoint configurado.');
            return;
        }

        setLoading(true);
        setError('');
        setResult(null);

        try {
            const response = await fetch(tool.endpoint, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildRequestBody('consulta-quiebra-credix', formValues)),
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(extractErrorMessage(payload));
            }

            setResult(payload);
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setLoading(false);
        }
    };

    const clearToolState = () => {
        setFormValues({ cuit: '', nombre: '' });
        setError('');
        setResult(null);
    };

    return (
        <div className="shell shell--wide">
            <section className="credix-page__topbar">
                <a className="credix-page__back" href="/">Herramientas</a>
                <img className="credix-page__logo" src={brandLogoUrl} alt="Red Unisol" />
            </section>

            <main className="credix-page">
                <section className="credix-page__header">
                    <div>
                        <p className="section__eyebrow">{branding.eyebrow}</p>
                        <h1 className="credix-page__title">Consulta CredixSA</h1>
                        <p className="credix-page__description">
                            Informe operativo normalizado para analisis de credito.
                        </p>
                    </div>
                    <div className="credix-page__status">
                        <span>Fuente</span>
                        <strong>{result?.cache_hit ? 'Cache SQLite' : result ? 'Consulta online' : 'CredixSA'}</strong>
                    </div>
                </section>

                <section className="panel credix-search">
                    <form className="credix-search__form" onSubmit={handleSubmit}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="credix-cuit">CUIL o DNI</label>
                                <input
                                    id="credix-cuit"
                                    name="cuit"
                                    placeholder="20-12345678-3 o 12345678"
                                    value={formValues.cuit}
                                    onChange={(event) =>
                                        setFormValues((current) => ({
                                            ...current,
                                            cuit: event.target.value,
                                        }))
                                    }
                                    autoComplete="off"
                                />
                            </div>

                            <div className="field">
                                <label htmlFor="credix-nombre">Nombre</label>
                                <input
                                    id="credix-nombre"
                                    name="nombre"
                                    placeholder="Apellido y nombre"
                                    value={formValues.nombre}
                                    onChange={(event) =>
                                        setFormValues((current) => ({
                                            ...current,
                                            nombre: event.target.value,
                                        }))
                                    }
                                    autoComplete="off"
                                />
                            </div>
                        </div>

                        <div className="actions">
                            <button className="button button--primary" disabled={loading} type="submit">
                                {loading ? 'Consultando...' : 'Consultar CredixSA'}
                            </button>
                            <button className="button button--ghost" type="button" onClick={clearToolState}>
                                Limpiar
                            </button>
                        </div>
                    </form>
                </section>

                {loading && (
                    <section className="loading-state" role="status" aria-live="polite">
                        <div className="loading-state__spinner" aria-hidden="true" />
                        <div className="loading-state__body">
                            <h2 className="loading-state__headline">Consultando CredixSA</h2>
                            <p className="loading-state__copy">{getLoadingCopy('consulta-quiebra-credix')}</p>
                        </div>
                    </section>
                )}

                {(error || result) && (
                    <section className={`result result--${resultTone} credix-page__result`}>
                        <div className="credix-page__resultHeader">
                            <div>
                                <h2 className="result__headline">{getResultHeadline('consulta-quiebra-credix', result, error)}</h2>
                                <p className="result__copy">{getResultCopy('consulta-quiebra-credix', result, error)}</p>
                            </div>
                            {result && (
                                <div className="credix-page__miniMetrics">
                                    <span>{result.cuit || 'Sin CUIL'}</span>
                                    <strong>{result.nombre || 'Sin nombre'}</strong>
                                </div>
                            )}
                        </div>

                        {result?.status === 'multiple' && (
                            <div className="result__stack">
                                <h3 className="result__subheading">Coincidencias encontradas</h3>
                                <div className="result__list">
                                    {parseJsonArray(result.rows_json).map((row, index) => (
                                        <article className="result__listItem" key={`${row.cuit || 'row'}-${index}`}>
                                            <strong>{row.nombre || 'Sin nombre'}</strong>
                                            <span>CUIT: {row.cuit || 'Sin dato'}</span>
                                            <span>Documento: {row.documento || 'Sin dato'}</span>
                                        </article>
                                    ))}
                                </div>
                            </div>
                        )}

                        {result?.status === 'single' && (
                            normalized ? (
                                <CredixDedicatedReport normalized={normalized} />
                            ) : (
                                <p className="result__empty">No hay datos normalizados disponibles para esta consulta.</p>
                            )
                        )}
                    </section>
                )}
            </main>
        </div>
    );
}

function CredixDedicatedReport({ normalized }) {
    return (
        <div className="credix-report">
            <CredixPersonPanel persona={normalized?.persona || {}} />
            <CredixBcraHistoryPanel bcra={normalized?.bcra || {}} />
            <CredixBcraEntityEvolutionPanel bcra={normalized?.bcra || {}} />
            <CredixPrevisionalHistoryPanel previsional={normalized?.previsional || {}} />
            <CredixQuiebrasPanel quiebras={normalized?.quiebras || {}} />
            <CredixSecondarySections normalized={normalized} />
        </div>
    );
}

function CredixSecondarySections({ normalized }) {
    return (
        <details className="credix-report__details">
            <summary>
                <span>Ver secciones adicionales</span>
            </summary>
            <div className="credix-report__detailsBody">
                <CredixBcraPanel bcra={normalized?.bcra || {}} />
                <CredixPrevisionalPanel previsional={normalized?.previsional || {}} />
                <CredixAportesPanel aportes={normalized?.aportes || {}} />
            </div>
        </details>
    );
}

function CredixPersonPanel({ persona }) {
    const birthDate = persona.fecha_nacimiento || extractBirthDate(persona.edad);
    const metrics = [
        ['Nombre completo', persona.nombre_completo],
        ['Edad', stripBirthDateFromAge(persona.edad)],
        ['Fecha de nacimiento', birthDate],
        ['Genero', persona.genero],
        ['Localidad', [persona.localidad, persona.provincia].filter(Boolean).join(' - ')],
        ['Documento', persona.documento],
        ['CUIL', persona.cuit],
    ].filter(([, value]) => value);

    return (
        <section className="credix-report__section credix-report__section--primary credix-report__section--person">
            <div className="credix-report__sectionHeader">
                <h2>Datos filiatorios</h2>
            </div>
            <div className="credix-report__metricGrid credix-report__metricGrid--compact">
                {metrics.map(([label, value]) => (
                    <article className="credix-report__metric credix-report__metric--compact" key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                    </article>
                ))}
            </div>
            {persona.domicilio && <p className="credix-report__note">{persona.domicilio}</p>}
        </section>
    );
}

function CredixBcraPanel({ bcra }) {
    const history = Array.isArray(bcra.historial_por_entidad) ? bcra.historial_por_entidad : [];
    const detailedHistoryRows = Array.isArray(bcra.evolucion_deuda_por_entidad?.filas)
        ? bcra.evolucion_deuda_por_entidad.filas
        : [];
    const entities = Array.isArray(bcra.entidades) ? bcra.entidades : [];
    const activeDebts = Array.isArray(bcra.deudas_vigentes) ? bcra.deudas_vigentes : [];

    return (
        <section className="credix-report__section">
            <div className="credix-report__sectionHeader">
                <h2>Situaciones BCRA</h2>
                <span className={`credix-risk credix-risk--${String(bcra.resumen?.color || '').toLowerCase()}`}>
                    {bcra.resumen?.color || 'Sin datos'}
                </span>
            </div>
            <div className="credix-report__metricGrid">
                <article className="credix-report__metric">
                    <span>Detalle</span>
                    <strong>{bcra.resumen?.detalle || 'Sin datos'}</strong>
                </article>
                <article className="credix-report__metric">
                    <span>Deuda vigente total</span>
                    <strong>{bcra.deuda_vigente_total || 'Sin datos'}</strong>
                </article>
                <article className="credix-report__metric">
                    <span>Entidades informadas</span>
                    <strong>{entities.length || 'Sin datos'}</strong>
                </article>
            </div>

            {activeDebts.length > 0 && (
                <CredixSimpleTable
                    columns={['Entidad', 'Periodo', 'Monto', 'Situacion']}
                    rows={activeDebts.map((row) => [
                        row.entidad || 'Sin dato',
                        row.periodo || 'Sin dato',
                        row.monto || 'Sin dato',
                        row.situacion || row.porcentaje || 'Sin dato',
                    ])}
                />
            )}

            {history.length > 0 && detailedHistoryRows.length === 0 && (
                <div className="credix-report__stack">
                    <h3>Historial por entidad</h3>
                    {history.slice(0, 6).map((period, index) => (
                        <article className="credix-report__item" key={`${period.periodo || 'periodo'}-${index}`}>
                            <strong>{period.periodo || 'Periodo sin dato'}</strong>
                            <div className="credix-report__pairs">
                                {Object.entries(period.entidades || {}).map(([entity, amount]) => (
                                    <span key={entity}>{entity}: {amount}</span>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function CredixBcraHistoryPanel({ bcra }) {
    const matrix = bcra?.deudas_24_meses || {};
    const years = Array.isArray(matrix.anios) ? matrix.anios : [];
    const months = Array.isArray(matrix.meses) ? matrix.meses : [];
    const rows = Array.isArray(matrix.filas) ? matrix.filas : [];

    if (years.length === 0 || months.length === 0 || rows.length === 0) {
        return null;
    }

    return (
        <section className="credix-report__section credix-report__section--primary">
            <div className="credix-report__sectionHeader">
                <h2>Deudas en el sistema financiero</h2>
                <span className="credix-risk">{matrix.fuente ? `Fuente: ${matrix.fuente}` : 'BCRA'}</span>
            </div>
            <div className="credix-bcra-history">
                <div className="credix-bcra-history__wrap">
                    <table className="credix-bcra-history__table">
                        <thead>
                            <tr>
                                <th rowSpan="2">Entidad</th>
                                {years.map((year, index) => (
                                    <th colSpan={year.span || 1} key={`${year.anio || 'anio'}-${index}`}>
                                        {year.anio || 'Sin dato'}
                                    </th>
                                ))}
                                <th rowSpan="2">Ultimo monto informado</th>
                                <th rowSpan="2">Obs.</th>
                            </tr>
                            <tr>
                                {months.map((month, index) => <th key={`${month}-${index}`}>{month}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rowIndex) => (
                                <tr
                                    className={row.activa ? 'credix-bcra-history__row credix-bcra-history__row--active' : 'credix-bcra-history__row'}
                                    key={`${row.entidad || 'entidad'}-${rowIndex}`}
                                >
                                    <th scope="row">{row.entidad || 'Sin dato'}</th>
                                    {(Array.isArray(row.situaciones) ? row.situaciones : []).map((value, valueIndex) => (
                                        <td className={`credix-bcra-history__status credix-bcra-history__status--${getBcraSituationClass(value)}`} key={`${rowIndex}-${valueIndex}`}>
                                            {value || '-'}
                                        </td>
                                    ))}
                                    <td className="credix-bcra-history__amount">{row.ultimo_monto_informado || '-'}</td>
                                    <td>{row.observacion || ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="credix-bcra-history__legend">
                    Referencias: <strong>1</strong> normal, <strong>2</strong> riesgo potencial, <strong>3</strong> con problemas,
                    <strong> 4</strong> alto riesgo, <strong>5</strong> irrecuperable, <strong>6</strong> irrecuperable por disposicion tecnica,
                    <strong> N/D</strong> no disponible.
                </p>
            </div>
        </section>
    );
}

function CredixBcraEntityEvolutionPanel({ bcra }) {
    const matrix = bcra?.evolucion_deuda_por_entidad || {};
    const entities = Array.isArray(matrix.entidades) ? matrix.entidades : [];
    const rows = Array.isArray(matrix.filas) ? matrix.filas : [];

    if (entities.length === 0 || rows.length === 0) {
        return null;
    }

    return (
        <section className="credix-report__section credix-report__section--primary">
            <div className="credix-report__sectionHeader">
                <h2>Evolucion deuda sistema financiero por entidad</h2>
                <span className="credix-risk">{matrix.fuente ? `Fuente: ${matrix.fuente}` : 'BCRA'}</span>
            </div>
            <div className="credix-bcra-evolution">
                <div className="credix-bcra-evolution__wrap">
                    <table className="credix-bcra-evolution__table">
                        <thead>
                            <tr>
                                <th>Periodo</th>
                                {entities.map((entity, index) => (
                                    <th key={`${entity}-${index}`}>{entity}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rowIndex) => (
                                <tr key={`${row.periodo || 'periodo'}-${rowIndex}`}>
                                    <th scope="row">{row.periodo || '-'}</th>
                                    {(Array.isArray(row.celdas) ? row.celdas : []).map((cell, cellIndex) => (
                                        <td
                                            className={`credix-bcra-evolution__cell credix-bcra-evolution__cell--${getBcraSituationClass(cell.situacion)}`}
                                            key={`${rowIndex}-${cellIndex}`}
                                        >
                                            {cell.monto || ''}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}

function CredixPrevisionalHistoryPanel({ previsional }) {
    const situations = Array.isArray(previsional?.situaciones_por_empleador)
        ? previsional.situaciones_por_empleador
        : [];

    if (situations.length === 0) {
        return null;
    }

    return (
        <section className="credix-report__section credix-report__section--primary">
            <div className="credix-report__sectionHeader">
                <h2>Situacion previsional detallada</h2>
            </div>
            <div className="credix-previsional-history">
                {situations.map((situation, index) => {
                    const employer = situation.empleador || {};
                    const periods = Array.isArray(situation.periodos) ? situation.periodos : [];
                    const employerLabel = [
                        formatCuit(employer.cuit),
                        employer.nombre,
                    ].filter(Boolean).join(' - ');

                    return (
                        <article className="credix-previsional-history__block" key={`${employer.cuit || 'empleador'}-${index}`}>
                            <div className="credix-previsional-history__titlebar">
                                <strong>Situacion previsional - Empleador {situation.indice || employer.indice || index + 1}</strong>
                                <span>{situation.fuente ? `Fuente: ${situation.fuente}` : 'Fuente no informada'}</span>
                            </div>
                            <div className="credix-previsional-history__meta">
                                <div>
                                    <span>Empleador</span>
                                    <strong>{employerLabel || 'Sin dato'}</strong>
                                </div>
                                <div>
                                    <span>Actividad</span>
                                    <strong>{employer.actividad || 'Sin dato'}</strong>
                                </div>
                                <div>
                                    <span>Domicilio</span>
                                    <strong>{employer.domicilio || 'Sin dato'}</strong>
                                </div>
                            </div>
                            {periods.length > 0 && (
                                <div className="credix-previsional-history__wrap">
                                    <table className="credix-previsional-history__table">
                                        <thead>
                                            <tr>
                                                <th>Periodo</th>
                                                <th>Incluido en declaracion jurada</th>
                                                <th>Aportes de seguridad social</th>
                                                <th>Aportes de obra social</th>
                                                <th>Contribucion patronal de obra social</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {periods.map((period, periodIndex) => (
                                                <tr key={`${period.periodo || 'periodo'}-${periodIndex}`}>
                                                    <td>{period.periodo || '-'}</td>
                                                    <td className={period.incluido_declaracion_jurada === 'SI' ? 'credix-previsional-history__yes' : ''}>
                                                        {period.incluido_declaracion_jurada || '-'}
                                                    </td>
                                                    <td>{period.aportes_seguridad_social || '-'}</td>
                                                    <td>{period.aportes_obra_social || '-'}</td>
                                                    <td>{period.contribucion_patronal_obra_social || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

function CredixPrevisionalPanel({ previsional }) {
    const employers = Array.isArray(previsional.empleadores) ? previsional.empleadores : [];
    const registrations = Array.isArray(previsional.registraciones) ? previsional.registraciones : [];

    return (
        <section className="credix-report__section">
            <div className="credix-report__sectionHeader">
                <h2>Situacion previsional</h2>
            </div>
            {previsional.mensaje && <p className="credix-report__note">{previsional.mensaje}</p>}
            {employers.length > 0 ? (
                <div className="credix-report__stack">
                    {employers.map((employer, index) => (
                        <article className="credix-report__item" key={`${employer.cuit || 'empleador'}-${index}`}>
                            <strong>{employer.nombre || 'Empleador sin nombre'}</strong>
                            <span>{employer.cuit || 'Sin CUIT'}</span>
                            <span>{employer.actividad || 'Sin actividad'}</span>
                            <span>{employer.domicilio || 'Sin domicilio'}</span>
                        </article>
                    ))}
                </div>
            ) : (
                <p className="result__empty">Sin empleadores informados.</p>
            )}
            {registrations.length > 0 && (
                <div className="credix-report__stack">
                    <h3>Registraciones</h3>
                    {registrations.map((registration, index) => (
                        <article className="credix-report__item" key={`${registration.periodo || 'registro'}-${index}`}>
                            <strong>{registration.periodo || 'Registro'}</strong>
                            <span>{registration.mensaje || 'Sin detalle'}</span>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function CredixQuiebrasPanel({ quiebras }) {
    const edicts = Array.isArray(quiebras.edictos) ? quiebras.edictos : [];

    return (
        <section className="credix-report__section">
            <div className="credix-report__sectionHeader">
                <h2>Quiebras</h2>
                <span className="credix-risk">{edicts.length ? `${edicts.length} edictos` : 'Sin edictos'}</span>
            </div>
            {edicts.length > 0 ? (
                <CredixSimpleTable
                    columns={['Fecha', 'Fuente', 'Resumen']}
                    rows={edicts.map((edict) => [
                        edict.fecha || 'Sin dato',
                        edict.fuente || 'Sin dato',
                        edict.resumen || 'Sin dato',
                    ])}
                />
            ) : (
                <p className="result__empty">{quiebras.mensaje || 'Sin edictos judiciales informados.'}</p>
            )}
        </section>
    );
}

function CredixAportesPanel({ aportes }) {
    const registrations = Array.isArray(aportes.registraciones) ? aportes.registraciones : [];
    const healthProviders = Array.isArray(aportes.obra_sociales) ? aportes.obra_sociales : [];
    const employers = Array.isArray(aportes.empleadores) ? aportes.empleadores : [];

    return (
        <section className="credix-report__section">
            <div className="credix-report__sectionHeader">
                <h2>Aportes</h2>
            </div>
            {aportes.mensaje && <p className="credix-report__note">{aportes.mensaje}</p>}
            <div className="credix-report__columns">
                <div className="credix-report__stack">
                    <h3>Registraciones</h3>
                    {registrations.length > 0 ? registrations.map((registration, index) => (
                        <article className="credix-report__item" key={`${registration.periodo || 'registro'}-${index}`}>
                            <strong>{registration.periodo || 'Registro'}</strong>
                            <span>{registration.mensaje || 'Sin detalle'}</span>
                        </article>
                    )) : <p className="result__empty">Sin registraciones informadas.</p>}
                </div>
                <div className="credix-report__stack">
                    <h3>Obra social</h3>
                    {healthProviders.length > 0 ? healthProviders.map((item, index) => (
                        <article className="credix-report__item" key={`${item.obra_social || item.mensaje || 'obra-social'}-${index}`}>
                            <strong>{item.obra_social || item.mensaje || 'Sin datos'}</strong>
                            {item.situacion_laboral && <span>{item.situacion_laboral}</span>}
                            {item.empleador && <span>{item.empleador}</span>}
                        </article>
                    )) : <p className="result__empty">Sin obra social informada.</p>}
                </div>
            </div>
            {employers.length > 0 && (
                <div className="credix-report__stack">
                    <h3>Empleadores vinculados</h3>
                    {employers.map((employer, index) => (
                        <article className="credix-report__item" key={`${employer.cuit || 'aporte-empleador'}-${index}`}>
                            <strong>{employer.nombre || 'Empleador sin nombre'}</strong>
                            <span>{employer.cuit || 'Sin CUIT'}</span>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function CredixSimpleTable({ columns, rows }) {
    return (
        <div className="result__tableWrap">
            <table className="result__table">
                <thead>
                    <tr>
                        {columns.map((column) => <th key={column}>{column}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => <td key={cellIndex}>{cell || 'Sin dato'}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CredixNormalizedSummary({ normalized }) {
    const persona = normalized?.persona || {};
    const bcra = normalized?.bcra || {};
    const previsional = normalized?.previsional || {};
    const aportes = normalized?.aportes || {};
    const quiebras = normalized?.quiebras || {};
    const personMetrics = [
        ['Nombre completo', persona.nombre_completo],
        ['Genero', persona.genero],
        ['Edad', persona.edad],
        ['Fecha de nacimiento', persona.fecha_nacimiento],
        ['Localidad', persona.localidad],
    ].filter(([, value]) => value);

    return (
        <div className="credix-summary">
            {personMetrics.length > 0 && (
                <section className="credix-summary__block">
                    <h5 className="credix-summary__title">Datos filiatorios</h5>
                    <div className="credix-summary__grid">
                        {personMetrics.map(([label, value]) => (
                            <article className="credix-summary__card" key={label}>
                                <span>{label}</span>
                                <strong>{value}</strong>
                            </article>
                        ))}
                    </div>
                    {persona.domicilio && <p className="credix-summary__note">{persona.domicilio}</p>}
                </section>
            )}

            <section className="credix-summary__block">
                <h5 className="credix-summary__title">Situacion BCRA</h5>
                <div className="credix-summary__grid">
                    <article className="credix-summary__card">
                        <span>Resumen</span>
                        <strong>{bcra.resumen?.color || 'Sin datos'}</strong>
                    </article>
                    <article className="credix-summary__card">
                        <span>Detalle</span>
                        <strong>{bcra.resumen?.detalle || 'Sin datos'}</strong>
                    </article>
                    <article className="credix-summary__card">
                        <span>Deuda vigente total</span>
                        <strong>{bcra.deuda_vigente_total || 'Sin datos'}</strong>
                    </article>
                </div>
                {Array.isArray(bcra.deudas_vigentes) && bcra.deudas_vigentes.length > 0 && (
                    <div className="result__tableWrap">
                        <table className="result__table">
                            <thead>
                                <tr>
                                    <th>Entidad</th>
                                    <th>Periodo</th>
                                    <th>Monto</th>
                                    <th>Situacion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bcra.deudas_vigentes.map((row, index) => (
                                    <tr key={`${row.entidad || 'bcra'}-${index}`}>
                                        <td>{row.entidad || 'Sin dato'}</td>
                                        <td>{row.periodo || 'Sin dato'}</td>
                                        <td>{row.monto || 'Sin dato'}</td>
                                        <td>{row.situacion || row.porcentaje || 'Sin dato'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="credix-summary__block">
                <h5 className="credix-summary__title">Situacion previsional</h5>
                {previsional.mensaje && <p className="credix-summary__note">{previsional.mensaje}</p>}
                {Array.isArray(previsional.empleadores) && previsional.empleadores.length > 0 ? (
                    <div className="credix-summary__stack">
                        {previsional.empleadores.map((employer, index) => (
                            <article className="credix-summary__card credix-summary__card--wide" key={`${employer.cuit || 'empleador'}-${index}`}>
                                <span>Empleador {employer.indice || index + 1}</span>
                                <strong>{employer.nombre || 'Sin dato'}</strong>
                                <p>{employer.cuit || 'Sin CUIT'}</p>
                                <p>{employer.actividad || 'Sin actividad'}</p>
                                <p>{employer.domicilio || 'Sin domicilio'}</p>
                            </article>
                        ))}
                    </div>
                ) : (
                    <p className="result__empty">Sin empleadores informados.</p>
                )}
            </section>

            <section className="credix-summary__block">
                <h5 className="credix-summary__title">Aportes</h5>
                {aportes.mensaje && <p className="credix-summary__note">{aportes.mensaje}</p>}
                {Array.isArray(aportes.registraciones) && aportes.registraciones.length > 0 && (
                    <div className="credix-summary__stack">
                        {aportes.registraciones.map((registration, index) => (
                            <article className="credix-summary__card credix-summary__card--wide" key={`${registration.periodo || 'registro'}-${index}`}>
                                <span>{registration.periodo || 'Registracion'}</span>
                                <strong>{registration.mensaje || 'Sin detalle'}</strong>
                            </article>
                        ))}
                    </div>
                )}
                {Array.isArray(aportes.obra_sociales) && aportes.obra_sociales.length > 0 && (
                    <div className="credix-summary__stack">
                        {aportes.obra_sociales.map((item, index) => (
                            <article className="credix-summary__card credix-summary__card--wide" key={`${item.obra_social || 'obra-social'}-${index}`}>
                                <span>Obra social</span>
                                <strong>{item.obra_social || item.mensaje || 'Sin datos'}</strong>
                                {item.situacion_laboral && <p>{item.situacion_laboral}</p>}
                                {item.empleador && <p>{item.empleador}</p>}
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <section className="credix-summary__block">
                <h5 className="credix-summary__title">Quiebras</h5>
                {Array.isArray(quiebras.edictos) && quiebras.edictos.length > 0 ? (
                    <div className="result__tableWrap">
                        <table className="result__table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Fuente</th>
                                    <th>Resumen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {quiebras.edictos.map((edicto, index) => (
                                    <tr key={`${edicto.fecha || 'edicto'}-${index}`}>
                                        <td>{edicto.fecha || 'Sin dato'}</td>
                                        <td>{edicto.fuente || 'Sin dato'}</td>
                                        <td>{edicto.resumen || 'Sin dato'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="result__empty">{quiebras.mensaje || 'Sin edictos judiciales informados.'}</p>
                )}
            </section>
        </div>
    );
}

function CredixSectionTable({ section }) {
    const records = Array.isArray(section.records) ? section.records : [];
    const rows = Array.isArray(section.rows) ? section.rows : [];

    if (records.length > 0) {
        const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
        return (
            <div className="result__tableWrap">
                <table className="result__table">
                    <thead>
                        <tr>
                            {headers.map((header) => (
                                <th key={header}>{header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {records.map((record, rowIndex) => (
                            <tr key={rowIndex}>
                                {headers.map((header) => (
                                    <td key={header}>{record[header] || 'Sin dato'}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (rows.length > 0) {
        return (
            <div className="result__tableWrap">
                <table className="result__table">
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                                    <td key={cellIndex}>{cell || 'Sin dato'}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    return <span>{section.text || 'Sin detalle'}</span>;
}

function getResultTone(toolId, result, error) {
    if (error || (result && result.ok === false)) {
        return 'error';
    }

    if (toolId === 'consulta-renovacion-cruz-del-eje') {
        if (result && result.puede_renovar) {
            return 'success';
        }
        return 'warning';
    }

    if (toolId === 'consulta-tope-descuento-caja') {
        return 'success';
    }

    if (toolId === 'consulta-quiebra-credix') {
        if (result?.status === 'single') {
            return 'success';
        }
        if (result?.status === 'multiple') {
            return 'warning';
        }
        return 'warning';
    }

    if (toolId === 'consulta-empleador') {
        if (result?.ok && result?.found) {
            return 'success';
        }
        return 'warning';
    }

    if (toolId === 'consulta-cuad') {
        if (result?.ok && result?.found) {
            return 'success';
        }
        return 'warning';
    }

    return 'warning';
}

function getResultHeadline(toolId, result, error) {
    if (error) {
        return 'No se pudo completar la consulta';
    }

    if (!result) {
        return '';
    }

    if (toolId === 'consulta-renovacion-cruz-del-eje') {
        if (result.ok && result.puede_renovar) {
            return 'Puede renovar';
        }
        if (result.ok) {
            return 'No puede renovar';
        }
        return 'Respuesta de validacion';
    }

    if (toolId === 'consulta-tope-descuento-caja') {
        return result.ok ? 'Consulta completada' : 'Respuesta de validacion';
    }

    if (toolId === 'consulta-quiebra-credix') {
        if (result.status === 'single') {
            return 'Resultado';
        }
        if (result.status === 'multiple') {
            return 'Resultados';
        }
        if (result.status === 'none') {
            return 'Resultado';
        }
        return 'Respuesta de validacion';
    }

    if (toolId === 'consulta-empleador') {
        if (result.ok && result.found) {
            return 'Consulta completada';
        }
        if (result.ok) {
            return 'Sin coincidencias';
        }
        return 'Respuesta de validacion';
    }

    if (toolId === 'consulta-cuad') {
        if (result.ok && result.found) {
            return 'Consulta completada';
        }
        if (result.ok) {
            return 'Sin coincidencias';
        }
        return 'Respuesta de validacion';
    }

    return 'Respuesta de validacion';
}

function getResultCopy(toolId, result, error) {
    if (error) {
        return error;
    }

    if (!result) {
        return '';
    }

    if (toolId === 'consulta-renovacion-cruz-del-eje') {
        if (result.ok && result.puede_renovar) {
            return 'Consulta completada correctamente.';
        }
        if (result.ok) {
            return humanizeReason(result.motivo || 'sin detalle');
        }
        return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
    }

    if (toolId === 'consulta-tope-descuento-caja') {
        if (result.ok) {
            return 'Datos obtenidos correctamente.';
        }
        return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
    }

    if (toolId === 'consulta-quiebra-credix') {
        if (result.status === 'single') {
            const total = parseJsonArray(result.data_json).length;
            return total > 0
                ? `Se obtuvo ${total} seccion${total === 1 ? '' : 'es'} del informe para la persona encontrada.`
                : 'Se encontro la persona, pero no hay secciones disponibles en el informe.';
        }
        if (result.status === 'multiple') {
            const total = parseJsonArray(result.rows_json).length;
            return `Se encontraron ${total} coincidencia${total === 1 ? '' : 's'} para ese criterio.`;
        }
        if (result.status === 'none') {
            return 'No se encontraron coincidencias para los criterios ingresados.';
        }
        return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
    }

    if (toolId === 'consulta-empleador') {
        if (result.ok && result.found) {
            return 'Datos obtenidos correctamente.';
        }
        if (result.ok && !result.found) {
            return 'No se encontraron datos para el identificador ingresado.';
        }
        return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
    }

    if (toolId === 'consulta-cuad') {
        if (result.ok && result.found) {
            return 'Datos obtenidos correctamente desde CUAD.';
        }
        if (result.ok && !result.found) {
            return 'No se encontraron datos para el CUIL ingresado.';
        }
        return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
    }

    return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
}

function buildRequestBody(toolId, formValues) {
    if (toolId === 'consulta-quiebra-credix') {
        return {
            cuit: formValues.cuit,
            nombre: formValues.nombre,
        };
    }

    if (toolId === 'consulta-empleador') {
        return {
            identificador: formValues.identificador,
        };
    }

    return {
        cuil: formValues.cuil,
    };
}

function extractErrorMessage(payload) {
    if (payload?.message) {
        return payload.message;
    }

    if (payload?.errors && typeof payload.errors === 'object') {
        const firstGroup = Object.values(payload.errors).find((value) => Array.isArray(value) && value.length > 0);
        if (firstGroup) {
            return firstGroup[0];
        }
    }

    return 'La consulta no pudo completarse.';
}

function parseJsonArray(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') {
        return [];
    }

    try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseJsonObject(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') {
        return null;
    }

    try {
        const parsed = JSON.parse(rawValue);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function getQuiebraRecordCount(result) {
    if (!result) {
        return '0';
    }

    if (result.status === 'multiple') {
        return String(parseJsonArray(result.rows_json).length);
    }

    if (result.status === 'single') {
        return String(parseJsonArray(result.data_json).length);
    }

    return '0';
}

function humanizeReason(value) {
    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getEmpleadorField(result, field) {
    if (!result?.data_json || typeof result.data_json !== 'string') {
        return '';
    }

    try {
        const parsed = JSON.parse(result.data_json);
        return String(parsed?.RESULTADO?.persona?.row?.[field] ?? '');
    } catch {
        return '';
    }
}

function formatCurrencyValue(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return 'No informado';
    }

    const numericValue = Number.parseFloat(String(rawValue).replace(',', '.'));

    if (!Number.isFinite(numericValue)) {
        return String(rawValue);
    }

    return currencyFormatter.format(numericValue);
}

function getBcraSituationClass(value) {
    const normalized = String(value || '').trim();
    return /^[1-6]$/.test(normalized) ? normalized : 'na';
}

function formatCuit(value) {
    const digits = String(value || '').replace(/\D+/g, '');
    if (digits.length !== 11) {
        return value || '';
    }
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function extractBirthDate(ageValue) {
    const match = String(ageValue || '').match(/\(([^)]+)\)/);
    return match?.[1] || '';
}

function stripBirthDateFromAge(ageValue) {
    return String(ageValue || '').replace(/\s*\([^)]+\)\s*/, '').trim();
}

function getLoadingHeadline(tool) {
    if (!tool?.title) {
        return 'Consultando herramienta';
    }

    return `Consultando ${tool.title}`;
}

function getLoadingCopy(toolId) {
    if (toolId === 'consulta-cuad') {
        return 'Esperando la respuesta del flujo. Puede demorar por el login, el captcha y la lectura OCR.';
    }

    if (toolId === 'consulta-quiebra-credix') {
        return 'Esperando la respuesta del flujo. La consulta puede demorar mientras se procesan los criterios y se arma el resultado.';
    }

    if (toolId === 'consulta-empleador') {
        return 'Esperando la respuesta del flujo. La consulta puede demorar mientras se valida el identificador y se recuperan los datos.';
    }

    if (toolId === 'consulta-tope-descuento-caja') {
        return 'Esperando la respuesta del flujo. La consulta puede demorar mientras se recupera la informacion de caja.';
    }

    return 'Esperando la respuesta del flujo. La consulta puede demorar unos segundos.';
}

function ObjectivesDashboardApp({ branding, config }) {
    const refreshMs = Math.max(Number(config.refreshSeconds || 60), 15) * 1000;
    const [snapshot, setSnapshot] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');

    const fetchSnapshot = React.useCallback(async () => {
        if (!config.snapshotEndpoint) {
            setLoading(false);
            setError('La pantalla no tiene configurado el origen de datos.');
            return;
        }

        try {
            const response = await fetch(config.snapshotEndpoint, {
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || payload.ok === false) {
                throw new Error(extractErrorMessage(payload));
            }

            setSnapshot(payload);
            setError('');
        } catch (snapshotError) {
            setError(snapshotError.message);
        } finally {
            setLoading(false);
        }
    }, [config.snapshotEndpoint]);

    React.useEffect(() => {
        fetchSnapshot();
        const timer = window.setInterval(fetchSnapshot, refreshMs);
        return () => window.clearInterval(timer);
    }, [fetchSnapshot, refreshMs]);

    const metrics = normalizeObjectiveMetrics(snapshot);
    const periodLabel = snapshot?.periodo_actual || snapshot?.current_period || 'Mes actual';
    const updatedAt = snapshot?.actualizado_en || snapshot?.updated_at;

    return (
        <div className="objectives-screen">
            <header className="objectives-header">
                <div className="brand">
                    <img className="brand__logo objectives-header__logo" src={brandLogoUrl} alt="Red Unisol" />
                    <div className="brand__copy">
                        <p className="brand__eyebrow">{branding.eyebrow}</p>
                        <p className="brand__title">Objetivos del mes</p>
                    </div>
                </div>
                <div className="objectives-header__meta">
                    <span>{periodLabel}</span>
                    <strong>{updatedAt ? `Actualizado ${formatDateTime(updatedAt)}` : 'Esperando actualizacion'}</strong>
                </div>
            </header>

            <main className="objectives-main">
                <section className="objectives-title">
                    <p className="section__eyebrow">Seguimiento comercial</p>
                    <h1>Objetivos de tiempos</h1>
                </section>

                {loading && (
                    <section className="objectives-state" role="status" aria-live="polite">
                        <div className="loading-state__spinner" aria-hidden="true" />
                        <p>Cargando metricas del mes.</p>
                    </section>
                )}

                {!loading && error && (
                    <section className="objectives-state objectives-state--error" role="status" aria-live="polite">
                        <p>{error}</p>
                    </section>
                )}

                {!loading && !error && metrics.length === 0 && (
                    <section className="objectives-state" role="status" aria-live="polite">
                        <p>No hay metricas publicadas para mostrar.</p>
                    </section>
                )}

                {!loading && !error && metrics.length > 0 && (
                    <section className="objective-grid">
                        {metrics.map((metric) => (
                            <ObjectiveMetricCard key={metric.id} metric={metric} />
                        ))}
                    </section>
                )}
            </main>
        </div>
    );
}

function ObjectiveMetricCard({ metric }) {
    const state = normalizeObjectiveState(metric.estado, metric.actualMin, metric.objetivoMin);
    const deltaText = formatDelta(metric.actualMin, metric.objetivoMin);

    return (
        <article className={`objective-card objective-card--${state}`}>
            <div className="objective-card__top">
                <h2>{metric.nombre}</h2>
                <span className="objective-card__status">{objectiveStateLabel(state)}</span>
            </div>

            <div className="objective-card__value">
                <strong>{formatMinutes(metric.actualMin)}</strong>
                <span>actual</span>
            </div>

            <div className="objective-card__target">
                <span>Objetivo</span>
                <strong>{formatMinutes(metric.objetivoMin)}</strong>
            </div>

            <div className="objective-card__footer">
                <span>{deltaText}</span>
                <strong>{metric.casos === null ? 'Sin casos' : `${metric.casos} casos`}</strong>
            </div>
        </article>
    );
}

function normalizeObjectiveMetrics(snapshot) {
    const rows = snapshot?.metricas || snapshot?.metrics || [];
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map((row, index) => ({
        id: row.id || row.key || `metric-${index}`,
        nombre: row.nombre || row.name || 'Objetivo',
        actualMin: toNumberOrNull(row.actual_min ?? row.current_min ?? row.actualMin),
        objetivoMin: toNumberOrNull(row.objetivo_min ?? row.target_min ?? row.objetivoMin),
        casos: toIntegerOrNull(row.casos ?? row.cases),
        estado: row.estado || row.status || null,
    }));
}

function toNumberOrNull(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function toIntegerOrNull(value) {
    const numberValue = Number(value);
    return Number.isInteger(numberValue) ? numberValue : null;
}

function normalizeObjectiveState(rawState, actualMin, targetMin) {
    const state = String(rawState || '').toLowerCase();
    if (['verde', 'green', 'ok'].includes(state)) {
        return 'green';
    }
    if (['amarillo', 'yellow', 'warning'].includes(state)) {
        return 'yellow';
    }
    if (['rojo', 'red', 'danger'].includes(state)) {
        return 'red';
    }
    if (actualMin === null || targetMin === null || targetMin <= 0) {
        return 'neutral';
    }
    if (actualMin <= targetMin) {
        return 'green';
    }
    if (actualMin <= targetMin * 1.15) {
        return 'yellow';
    }
    return 'red';
}

function objectiveStateLabel(state) {
    if (state === 'green') {
        return 'En objetivo';
    }
    if (state === 'yellow') {
        return 'Cerca';
    }
    if (state === 'red') {
        return 'A recuperar';
    }
    return 'Sin datos';
}

function formatMinutes(value) {
    if (value === null) {
        return 'Sin datos';
    }
    if (value >= 60) {
        const hours = value / 60;
        return `${hours.toLocaleString('es-AR', { maximumFractionDigits: 1 })} h`;
    }
    return `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} min`;
}

function formatDelta(actualMin, targetMin) {
    if (actualMin === null || targetMin === null || targetMin <= 0) {
        return 'Sin comparacion disponible';
    }

    const deltaPercent = ((actualMin - targetMin) / targetMin) * 100;
    const absolute = Math.abs(deltaPercent).toLocaleString('es-AR', { maximumFractionDigits: 1 });

    if (deltaPercent <= 0) {
        return `${absolute}% mejor que el objetivo`;
    }

    return `${absolute}% por encima del objetivo`;
}

function ContabilidadTransferApp({ branding, config }) {
    const [selectedDate, setSelectedDate] = React.useState(config.today || new Date().toISOString().slice(0, 10));
    const [loading, setLoading] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState('');

    const fetchStatus = React.useCallback(async (date) => {
        if (!config.statusEndpoint) {
            setError('La consulta de outputs no esta configurada.');
            return;
        }

        setLoading(true);
        setError('');
        setResult(null);

        try {
            const endpoint = new URL(config.statusEndpoint, window.location.origin);
            endpoint.searchParams.set('fecha', date);

            const response = await fetch(endpoint.toString(), {
                headers: { Accept: 'application/json' },
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || payload.ok === false) {
                throw new Error(extractErrorMessage(payload));
            }

            setResult(payload);
        } catch (statusError) {
            setError(statusError.message);
        } finally {
            setLoading(false);
        }
    }, [config.statusEndpoint]);

    React.useEffect(() => {
        fetchStatus(selectedDate);
    }, [fetchStatus, selectedDate]);

    const metadata = result?.metadata || {};
    const downloads = result?.downloads || {};

    return (
        <div className="shell shell--report">
            <section className="report-header">
                <div className="brand">
                    <img className="brand__logo" src={brandLogoUrl} alt="Red Unisol" />
                    <div className="brand__copy">
                        <p className="brand__eyebrow">{branding.eyebrow}</p>
                        <p className="brand__title">Contabilidad</p>
                    </div>
                </div>
                <div className="report-header__copy">
                    <h1>Transferencias Vimarx</h1>
                    <p>Reportes diarios generados desde los TXT bancarios del SFTP.</p>
                </div>
            </section>

            <main className="report-layout">
                <section className="panel report-panel">
                    <div className="report-panel__top">
                        <div>
                            <p className="section__eyebrow">Fecha</p>
                            <h2>Output disponible</h2>
                        </div>
                    </div>

                    <div className="field report-date-field">
                        <label htmlFor="contabilidad-fecha">Seleccionar fecha</label>
                        <input
                            id="contabilidad-fecha"
                            type="date"
                            value={selectedDate}
                            onChange={(event) => setSelectedDate(event.target.value)}
                        />
                    </div>

                    {loading && (
                        <section className="loading-state" role="status" aria-live="polite">
                            <div className="loading-state__spinner" aria-hidden="true" />
                            <div className="loading-state__body">
                                <h3 className="loading-state__headline">Buscando output</h3>
                                <p className="loading-state__copy">Consultando los archivos generados para la fecha seleccionada.</p>
                            </div>
                        </section>
                    )}

                    {error && (
                        <section className="result result--error">
                            <h3 className="result__headline">No se pudo consultar</h3>
                            <p className="result__copy">{error}</p>
                        </section>
                    )}

                    {!loading && !error && result && !result.found && (
                        <section className="result result--warning">
                            <h3 className="result__headline">Sin output</h3>
                            <p className="result__copy">{result.message}</p>
                        </section>
                    )}

                    {!loading && !error && result?.found && (
                        <section className="result result--success">
                            <h3 className="result__headline">Output encontrado</h3>
                            <p className="result__copy">El reporte Vimarx de la fecha seleccionada esta disponible para descarga.</p>

                            <div className="result__grid report-metrics">
                                <div className="result__metric">
                                    <span>Generado</span>
                                    <strong>{formatDateTime(metadata.generated_at)}</strong>
                                </div>
                                <div className="result__metric">
                                    <span>Movimientos</span>
                                    <strong>{metadata.movement_count ?? 'Sin dato'}</strong>
                                </div>
                                <div className="result__metric">
                                    <span>CUITs</span>
                                    <strong>{metadata.unique_cuit_count ?? 'Sin dato'}</strong>
                                </div>
                                <div className="result__metric">
                                    <span>Matches altos</span>
                                    <strong>{metadata.high_match_row_count ?? 'Sin dato'}</strong>
                                </div>
                                <div className="result__metric">
                                    <span>Archivos TXT</span>
                                    <strong>{metadata.downloaded_file_count ?? 'Sin dato'}</strong>
                                </div>
                                <div className="result__metric">
                                    <span>Filas</span>
                                    <strong>{metadata.full_row_count ?? 'Sin dato'}</strong>
                                </div>
                            </div>

                            <div className="report-downloads">
                                <a className="button button--primary" href={downloads.full}>
                                    Descargar Excel completo
                                </a>
                                <a className="button button--ghost" href={downloads.high_matches}>
                                    Descargar matches altos
                                </a>
                            </div>
                        </section>
                    )}
                </section>
            </main>
        </div>
    );
}

function formatDateTime(value) {
    if (!value) {
        return 'Sin dato';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(date);
}

if (rootElement) {
    let component = <App branding={initialPayload.branding || {}} tools={initialPayload.tools || []} />;

    if (initialPayload.mode === 'contabilidad-transfer') {
        component = (
            <ContabilidadTransferApp
                branding={initialPayload.branding || {}}
                config={initialPayload.contabilidad || {}}
            />
        );
    } else if (initialPayload.mode === 'objectives-dashboard') {
        component = (
            <ObjectivesDashboardApp
                branding={initialPayload.branding || {}}
                config={initialPayload.objectives || {}}
            />
        );
    } else if (initialPayload.page === 'credixsa') {
        const tools = initialPayload.tools || [];
        const credixTool = tools.find((tool) => tool.id === 'consulta-quiebra-credix') || {};
        component = (
            <CredixsaPage
                branding={initialPayload.branding || {}}
                tool={credixTool}
            />
        );
    }

    createRoot(rootElement).render(component);
}
