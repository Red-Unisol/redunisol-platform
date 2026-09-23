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
            endpoint: '/credix' }],
    });
    dom.window.fetch = fetch;
    dom.window.eval(bundle);
    return { dom, document: dom.window.document, errors };
}

for (const source of ['BCRA', 'CredixSA']) {
    test(`DOM: informe precalentado ${source} muestra tablas finales sin otra consulta`, async () => {
        const requests = [];
        const report = credix();
        const normalized = JSON.parse(report.normalized_json);
        normalized.bcra = { ...bcra(source, '$ 2.000'),
            consulta_directa_estado: source === 'BCRA' ? 'ok' : 'unavailable' };
        report.normalized_json = JSON.stringify(normalized);
        const app = mount(async (url) => {
            requests.push(url);
            assert.equal(url, '/credix');
            return response(report);
        });
        try {
            await until(() => app.document.querySelector('[aria-label="Deudas vigentes"]'));
            const panel = app.document.querySelector('[aria-label="Deudas vigentes"]');
            assert.ok(panel.textContent.includes(`Fuente: ${source}`));
            assert.match(panel.textContent, /Total en situación ≥ 2\$ 2\.000/);
            assert.deepEqual([...panel.querySelectorAll('th')].map((el) => el.textContent),
                ['Entidad', 'Periodo', 'Monto', 'Situacion']);
            assert.equal([...app.document.querySelectorAll('.credix-report__sectionHeader .credix-risk')]
                .filter((el) => el.textContent === `Fuente: ${source}`).length, 3);
            assert.doesNotMatch(app.document.body.textContent, /Consultando BCRA/);
            if (source === 'CredixSA') assert.match(panel.textContent, /No se pudo completar la consulta a BCRA/);
            await pause();
            assert.deepEqual(requests, ['/credix']);
            assert.deepEqual(app.errors, []);
        } finally { app.dom.window.close(); }
    });
}

test('DOM: situación cero de BCRA conserva el valor y el monto con color neutro', async () => {
    const report = credix();
    const normalized = JSON.parse(report.normalized_json);
    normalized.bcra.deudas_24_meses.filas[0].situaciones = ['0'];
    normalized.bcra.evolucion_deuda_por_entidad.filas[0].celdas[0].situacion = '0';
    report.normalized_json = JSON.stringify(normalized);
    const app = mount(async () => response(report));
    try {
        await until(() => app.document.querySelector('.credix-bcra-history__status'));
        const cell = app.document.querySelector('.credix-bcra-history__status');
        assert.equal(cell.textContent, '0');
        assert.ok(cell.classList.contains('credix-bcra-history__status--na'));
        const amount = app.document.querySelector('.credix-bcra-evolution__cell');
        assert.match(amount.textContent, /1\.000/);
        assert.ok(amount.classList.contains('credix-bcra-evolution__cell--na'));
        assert.match(app.document.body.textContent, /Fuente: BCRA/);
    } finally { app.dom.window.close(); }
});

for (const state of ['invalid_response', 'processing_error']) {
    test(`DOM: ${state} explica el problema de procesamiento y conserva CredixSA`, async () => {
        const report = credix();
        const normalized = JSON.parse(report.normalized_json);
        normalized.bcra.fuente = 'CredixSA';
        normalized.bcra.consulta_directa_estado = state;
        report.normalized_json = JSON.stringify(normalized);
        const app = mount(async () => response(report));
        try {
            await until(() => app.document.querySelector('[aria-label="Deudas vigentes"]'));
            const panel = app.document.querySelector('[aria-label="Deudas vigentes"]');
            assert.match(panel.textContent, /No se pudo procesar la respuesta de BCRA/);
            assert.doesNotMatch(panel.textContent, /no estuvo disponible/);
            assert.match(panel.textContent, /Fuente: CredixSA/);
            assert.match(panel.textContent, /1\.000/);
        } finally { app.dom.window.close(); }
    });
}

test('DOM: cache anterior sin fuente sigue siendo CredixSA y no dispara consultas', async () => {
    const requests = [];
    const report = credix();
    const normalized = JSON.parse(report.normalized_json);
    delete normalized.bcra.fuente;
    report.normalized_json = JSON.stringify(normalized);
    const app = mount(async (url) => { requests.push(url); return response(report); });
    try {
        await until(() => app.document.querySelector('[aria-label="Deudas vigentes"]'));
        assert.match(app.document.querySelector('[aria-label="Deudas vigentes"]').textContent, /Fuente: CredixSA/);
        await pause();
        assert.deepEqual(requests, ['/credix']);
    } finally { app.dom.window.close(); }
});
