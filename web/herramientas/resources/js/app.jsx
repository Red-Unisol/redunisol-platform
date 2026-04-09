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
    const [formValues, setFormValues] = React.useState({
        cuil: '',
        cuit: '',
        nombre: '',
    });
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
        setFormValues({
            cuil: '',
            cuit: '',
            nombre: '',
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
                                </div>
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
                                            <h4 className="result__subheading">Edictos judiciales</h4>
                                            {parseJsonArray(result.data_json).length > 0 ? (
                                                <div className="result__tableWrap">
                                                    <table className="result__table">
                                                        <thead>
                                                            <tr>
                                                                <th>Fecha</th>
                                                                <th>Fuente</th>
                                                                <th>ID</th>
                                                                <th>Resumen</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {parseJsonArray(result.data_json).map((item, index) => (
                                                                <tr key={`${item.id || 'edict'}-${index}`}>
                                                                    <td>{item.fecha || 'Sin dato'}</td>
                                                                    <td>{item.fuente || 'Sin dato'}</td>
                                                                    <td>{item.id || 'Sin dato'}</td>
                                                                    <td>{item.resumen || 'Sin dato'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <p className="result__empty">No hay filas en la tabla de edictos.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    )}
                </section>
            )}
        </div>
    );
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
                ? `Se obtuvo ${total} fila${total === 1 ? '' : 's'} de edictos para la persona encontrada.`
                : 'Se encontro la persona, pero no hay filas en la tabla de edictos.';
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

    return result.message || result.error || 'La consulta devolvio una respuesta no esperada.';
}

function buildRequestBody(toolId, formValues) {
    if (toolId === 'consulta-quiebra-credix') {
        return {
            cuit: formValues.cuit,
            nombre: formValues.nombre,
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

if (rootElement) {
    createRoot(rootElement).render(<App branding={initialPayload.branding || {}} tools={initialPayload.tools || []} />);
}
