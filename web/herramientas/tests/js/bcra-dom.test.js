import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const manifest = JSON.parse(readFileSync(new URL('../../public/build/manifest.json', import.meta.url)));
const bundle = readFileSync(new URL(`../../public/build/${manifest['resources/js/app.js'].file}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
    for (let i = 0; i < 200; i++) { if (check()) return; await wait(); }
    assert.fail('BCRA DOM condition did not become true');
}
const catalog = { lines: [
    { id: '10', name: 'MUDON HABERES', superior_id: '10', superior_name: 'MUDON HABERES', included_by_default: true },
    { id: '21', name: 'MEDICA PREMIUM', superior_id: '20', superior_name: 'Haberes CUAD SANTA FE', included_by_default: false },
    { id: '22', name: 'CAJA PLAN DESENDEUDAMIENTO', superior_id: '20', superior_name: 'Haberes CUAD SANTA FE', included_by_default: true },
], excluded_cuits: [{ value: '20123456786', reason: 'Exclusión de prueba' }] };
function mount(fetch, authenticated = true, storageDisabled = false) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => errors.push(err.message));
    const dom = new JSDOM('<!doctype html><meta name="csrf-token" content="test-csrf"><div id="app"></div>', {
        url: 'https://tools.test/bcra', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
    });
    const w = dom.window;
    w.document.getElementById('app').dataset.payload = JSON.stringify({ page: 'bcra', bcra: {
        authenticated, accessConfigured: true, configured: true, latestClosedMonth: '2026-09',
    } });
    const timeout = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 4000 ? 20 : ms, ...args);
    w.fetch = fetch;
    if (storageDisabled) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('Storage disabled'); } });
    w.eval(bundle);
    return { dom, window: w, document: w.document, errors };
}
function input(app, element, value) {
    const proto = element.tagName === 'TEXTAREA' ? app.window.HTMLTextAreaElement.prototype : app.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new app.window.Event('input', { bubbles: true }));
}

test('BCRA: protected page does not request source data before login', async () => {
    const app = mount(() => assert.fail('Unexpected data request'), false);
    try {
        await until(() => app.document.querySelector('input[type="password"]'));
        assert.equal(app.document.querySelector('.bcra-workspace'), null);
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});

test('BCRA: defaults, editable selection, mandatory exclusion reasons, single submission and recovery from polling failure', async () => {
    const posts = [];
    let polls = 0;
    let generated = false;
    const metadata = { run_id: 'run-test', period: '2026-07', status: 'SUCCESS', debtors: 8237, loans: 10925, total_miles: 123456 };
    const app = mount(async (url, options = {}) => {
        if (url === '/api/bcra/catalog') return response(catalog);
        if (url === '/api/bcra/runs' && options.method === 'POST') {
            posts.push({ body: JSON.parse(options.body), csrf: options.headers['X-CSRF-TOKEN'] }); generated = true;
            return response({ execution_id: 'execution-test-123456', status: 'CREATED' }, 202);
        }
        if (url === '/api/bcra/runs') return response({ runs: generated ? [{ metadata, downloads: { zip: '/download/test.zip' } }] : [] });
        if (url.includes('/api/bcra/executions/')) {
            polls++;
            if (polls === 1) return response({ message: 'Temporary failure' }, 503);
            return response({ execution_id: 'execution-test-123456', status: 'SUCCESS', metadata, downloads: { zip: '/download/test.zip' } });
        }
        throw new Error(`Unexpected fetch ${url}`);
    });
    try {
        await until(() => app.document.querySelector('.bcra-workspace'));
        assert.equal(posts.length, 0);
        assert.equal(app.document.querySelector('[aria-label="TNA promedio"]').value, '');
        assert.match(app.document.body.textContent, /no reconstruye saldos históricos/);
        const medica = [...app.document.querySelectorAll('.bcra-line-group label')].find((label) => label.textContent.includes('MEDICA'));
        assert.equal(medica.querySelector('input').checked, false);
        medica.querySelector('input').click();
        input(app, app.document.querySelector('input[type="month"]'), '2026-07');
        input(app, [...app.document.querySelectorAll('label')].find((label) => label.textContent.startsWith('Preparado por')).querySelector('input'), 'Pato');
        input(app, app.document.querySelector('[aria-label="TNA promedio"]'), '112,00');
        input(app, app.document.querySelector('[aria-label="CUIT excluidos"]'), '20123456786');
        await wait();
        app.document.querySelector('form.bcra-workspace').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
        await until(() => app.document.querySelector('[role="alert"]'));
        assert.equal(posts.length, 0);
        input(app, app.document.querySelector('[aria-label="CUIT excluidos"]'), '20123456786; Motivo de prueba');
        await wait();
        app.document.querySelector('form.bcra-workspace').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
        await until(() => app.document.querySelector('.bcra-result--success'));
        assert.equal(posts.length, 1);
        assert.equal(posts[0].csrf, 'test-csrf');
        assert.equal(posts[0].body.period, '2026-07');
        assert.equal(posts[0].body.declared_by, 'Pato');
        assert.deepEqual(posts[0].body.selected_line_ids.sort(), ['10', '21', '22']);
        assert.equal(posts[0].body.excluded_cuits[0].reason, 'Motivo de prueba');
        assert.match(app.document.querySelector('.bcra-result').textContent, /8.237/);
        assert.match(app.document.querySelector('.bcra-result a').href, /\/download\/test.zip$/);
        await until(() => app.document.querySelector('.bcra-history tbody tr'));
        assert.equal(app.window.sessionStorage.getItem('bcra-active-execution'), null);
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});

test('BCRA: catalog failure never enables generation or substitutes an empty result', async () => {
    const app = mount(async () => response({ message: 'Vimarx no disponible' }, 503));
    try {
        await until(() => app.document.querySelector('[role="alert"]'));
        assert.equal(app.document.querySelector('form.bcra-workspace'), null);
        assert.equal(app.document.querySelector('.bcra-result'), null);
        assert.match(app.document.body.textContent, /Vimarx no disponible/);
    } finally { app.dom.window.close(); }
});

test('BCRA: blocked storage and rapid repeated submissions do not lose or duplicate a confirmed execution', async () => {
    let starts = 0;
    let confirmStart;
    const metadata = { run_id: 'run-storage-test', period: '2026-07', status: 'SUCCESS', debtors: 1 };
    const app = mount(async (url, options = {}) => {
        if (url === '/api/bcra/catalog') return response(catalog);
        if (url === '/api/bcra/runs' && options.method === 'POST') {
            starts++;
            await new Promise((resolve) => { confirmStart = resolve; });
            return response({ execution_id: 'storage-disabled-execution', status: 'CREATED' }, 202);
        }
        if (url === '/api/bcra/runs') return response({ runs: [] });
        if (url.includes('/api/bcra/executions/')) return response({ execution_id: 'storage-disabled-execution', status: 'SUCCESS', metadata, downloads: { zip: '/download/storage.zip' } });
        throw new Error(`Unexpected fetch ${url}`);
    }, true, true);
    try {
        await until(() => app.document.querySelector('.bcra-workspace'));
        const submit = () => app.document.querySelector('form.bcra-workspace').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
        submit(); submit();
        await until(() => starts === 1);
        confirmStart();
        await until(() => app.document.querySelector('.bcra-result--success'));
        assert.equal(starts, 1);
        assert.match(app.document.querySelector('.bcra-result a').href, /\/download\/storage.zip$/);
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});
