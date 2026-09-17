import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const manifest = JSON.parse(readFileSync(new URL('../../public/build/manifest.json', import.meta.url)));
const bundle = readFileSync(new URL(`../../public/build/${manifest['resources/js/app.js'].file}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, json: async () => body });
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(check) {
    for (let i = 0; i < 150; i++) { if (check()) return; await pause(); }
    assert.fail('La pantalla no llegó al estado esperado');
}
const bcra = (source, amount) => ({
    fuente: source, deuda_vigente_total: amount, deuda_situacion_negativa_total: amount,
    deudas_vigentes: [{ entidad: 'Banco de prueba', periodo: '07/2026', situacion: '2', monto: amount }],
    deudas_24_meses: { anios: [{ anio: '2026', span: 1 }], meses: ['Jul'],
        filas: [{ entidad: 'Banco de prueba', situaciones: ['2'], ultimo_monto_informado: amount }] },
    evolucion_deuda_por_entidad: { entidades: ['Banco de prueba'],
        filas: [{ periodo: '07/2026', celdas: [{ entidad: 'Banco de prueba', situacion: '2', monto: amount }] }] },
});
const credix = () => ({ ok: true, status: 'single', cuit: '12345678', cache_hit: true,
    normalized_json: JSON.stringify({ persona: { cuit: '20123456786', nombre: 'Persona de prueba' },
        bcra: bcra('BCRA', '$ 1.000'), previsional: {}, quiebras: {}, aportes: {} }) });

function mount(fetch) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {
        url: 'https://herramientas.test/credixsa#cuit=12345678', runScripts: 'outside-only',
        pretendToBeVisual: true, virtualConsole,
    });
    dom.window.document.getElementById('app').dataset.payload = JSON.stringify({
        page: 'credixsa', branding: {}, tools: [{ id: 'consulta-quiebra-credix',
            endpoint: '/credix', bcraEndpoint: '/bcra' }],
    });
    dom.window.fetch = fetch;
    dom.window.eval(bundle);
    return { dom, document: dom.window.document, errors };
}

test('DOM: cache CredixSA aparece primero y BCRA reemplaza las tablas sin cambiar su formato', async () => {
    let finish;
    const app = mount(async (url, options) => {
        if (url === '/credix') return response(credix());
        assert.equal(url, '/bcra');
        assert.deepEqual(JSON.parse(options.body), { cuit: '20123456786' });
        return new Promise((resolve) => { finish = resolve; });
    });
    try {
        await until(() => finish && app.document.querySelector('[aria-label="Deudas vigentes"]'));
        const panel = app.document.querySelector('[aria-label="Deudas vigentes"]');
        assert.match(panel.textContent, /Fuente: CredixSA/);
        assert.match(panel.textContent, /Consultando BCRA/);
        const headers = [...panel.querySelectorAll('th')].map((el) => el.textContent);
        finish(response({ ok: true, bcra: { ...bcra('BCRA', '$ 2.000'), consultado_en: '2026-09-17T13:00:00Z' } }));
        await until(() => panel.textContent.includes('Fuente: BCRA'));
        assert.deepEqual([...panel.querySelectorAll('th')].map((el) => el.textContent), headers);
        assert.match(panel.textContent, /\$ 2\.000/);
        assert.doesNotMatch(panel.textContent, /\$ 1\.000/);
        assert.equal(app.document.querySelectorAll('.credix-report__sectionHeader .credix-risk').length >= 3, true);
        assert.equal([...app.document.querySelectorAll('.credix-report__sectionHeader .credix-risk')]
            .filter((el) => el.textContent === 'Fuente: BCRA').length, 3);
        assert.deepEqual(app.errors, []);
    } finally { app.dom.window.close(); }
});

test('DOM: al fallar BCRA conserva las deudas, el subtotal y la fuente CredixSA', async () => {
    const app = mount(async (url) => response(url === '/credix' ? credix() : { ok: false, bcra: null }));
    try {
        await until(() => app.document.body.textContent.includes('BCRA no disponible'));
        const panel = app.document.querySelector('[aria-label="Deudas vigentes"]');
        assert.match(panel.textContent, /Fuente: CredixSA/);
        assert.match(panel.textContent, /Total en situación ≥ 2\$ 1\.000/);
        assert.equal([...app.document.querySelectorAll('.credix-report__sectionHeader .credix-risk')]
            .filter((el) => el.textContent === 'Fuente: CredixSA').length, 3);
        assert.deepEqual(app.errors, []);
    } finally { app.dom.window.close(); }
});

test('DOM: limpiar y volver a consultar descarta una respuesta BCRA tardía de la consulta anterior', async () => {
    const pending = [];
    const app = mount(async (url) => {
        if (url === '/credix') return response(credix());
        return new Promise((resolve) => pending.push(resolve));
    });
    try {
        await until(() => pending.length === 1);
        app.document.querySelector('.button--ghost').click();
        await until(() => !app.document.querySelector('[aria-label="Deudas vigentes"]'));
        app.document.querySelector('form').dispatchEvent(new app.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await until(() => pending.length === 2);
        pending[0](response({ ok: true, bcra: bcra('BCRA', '$ 999.000') }));
        await pause();
        assert.doesNotMatch(app.document.body.textContent, /999\.000/);
        pending[1](response({ ok: true, bcra: bcra('BCRA', '$ 2.000') }));
        await until(() => app.document.body.textContent.includes('$ 2.000'));
        assert.deepEqual(app.errors, []);
    } finally { app.dom.window.close(); }
});
