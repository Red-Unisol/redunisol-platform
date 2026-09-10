import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const manifest = JSON.parse(readFileSync(new URL('../../public/build/manifest.json', import.meta.url)));
const bundle = readFileSync(new URL(`../../public/build/${manifest['resources/js/app.js'].file}`, import.meta.url), 'utf8');

async function mount(metrics) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {
        url: 'https://herramientas.test/objetivos/oficina',
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
    });
    dom.window.document.getElementById('app').dataset.payload = JSON.stringify({
        mode: 'objectives-dashboard', branding: {},
        objectives: { snapshotEndpoint: '/api/objetivos/oficina/snapshot', refreshSeconds: 60 },
    });
    dom.window.fetch = async () => ({ ok: true, json: async () => ({
        ok: true, periodo_actual: '2026-09', metricas: metrics,
    }) });
    dom.window.eval(bundle);
    for (let i = 0; i < 150; i++) {
        if (dom.window.document.querySelector('.objective-card')) {
            assert.deepEqual(errors, []);
            return dom;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    dom.window.close();
    assert.fail('El dashboard no mostró las métricas');
}

const metric = (id, nombre) => ({
    id, nombre, actual_min: 40, objetivo_min: 30, estado: 'rojo', casos: 125,
    mediana: { actual_min: 2.5, objetivo_min: 3, estado: 'verde' },
});

test('dashboard: ambas categorías muestran promedio y mediana con objetivos y estados independientes', async () => {
    const dom = await mount([
        metric('first_response', 'Tiempo de Primera Respuesta'),
        metric('transfer', 'Tiempo de Transferencia'),
    ]);
    try {
        const categories = dom.window.document.querySelectorAll('.objective-category');
        assert.equal(categories.length, 2);
        assert.match(categories[0].querySelector('h2').textContent, /Primera Respuesta/);
        assert.match(categories[1].querySelector('h2').textContent, /Transferencia/);
        for (const category of categories) {
            const [mean, median] = category.querySelectorAll('.objective-card');
            assert.equal(mean.querySelector('h3').textContent, 'Promedio');
            assert.equal(median.querySelector('h3').textContent, 'Mediana');
            assert.ok(mean.classList.contains('objective-card--red'));
            assert.ok(median.classList.contains('objective-card--green'));
            assert.equal(median.querySelector('.objective-card__value strong').textContent, '2,5 min');
            assert.equal(median.querySelector('.objective-card__target strong').textContent, '3 min');
            assert.match(median.querySelector('.objective-card__footer').textContent, /16,7% mejor/);
            assert.match(median.textContent, /125 casos/);
        }
    } finally { dom.window.close(); }
});

test('dashboard: snapshot anterior y valores nulos no inventan una mediana ni un cero', async () => {
    const old = metric('first_response', 'Respuesta');
    delete old.mediana;
    const empty = metric('transfer', 'Transferencia');
    empty.mediana = { actual_min: null, objetivo_min: null, estado: 'neutral' };
    const dom = await mount([old, empty]);
    try {
        for (const category of dom.window.document.querySelectorAll('.objective-category')) {
            const [mean, median] = category.querySelectorAll('.objective-card');
            assert.equal(mean.querySelector('.objective-card__value strong').textContent, '40 min');
            assert.equal(median.querySelector('.objective-card__value strong').textContent, 'Sin datos');
            assert.equal(median.querySelector('.objective-card__target strong').textContent, 'Sin datos');
            assert.ok(median.classList.contains('objective-card--neutral'));
            assert.match(median.textContent, /Sin comparacion disponible/);
        }
    } finally { dom.window.close(); }
});

test('dashboard: cero real es válido y se respeta el estado del servidor sin reclasificar por redondeo', async () => {
    const zero = metric('first_response', 'Respuesta');
    zero.mediana = { actual_min: 0, objetivo_min: 3, estado: 'verde' };
    const pending = metric('transfer', 'Transferencia');
    pending.mediana = { actual_min: 2, objetivo_min: 3, estado: 'neutral' };
    const dom = await mount([zero, pending]);
    try {
        const medians = [...dom.window.document.querySelectorAll('.objective-category')]
            .map((category) => category.querySelectorAll('.objective-card')[1]);
        assert.equal(medians[0].querySelector('.objective-card__value strong').textContent, '0 min');
        assert.ok(medians[0].classList.contains('objective-card--green'));
        assert.ok(medians[1].classList.contains('objective-card--neutral'));
    } finally { dom.window.close(); }
});
