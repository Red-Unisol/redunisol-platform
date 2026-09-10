import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const manifest = JSON.parse(readFileSync(new URL('../../public/build/manifest.json', import.meta.url)));
const bundle = readFileSync(new URL(`../../public/build/${manifest['resources/js/app.js'].file}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
    for (let i = 0; i < 150; i++) { if (check()) return; await sleep(10); }
    assert.fail('DOM condition did not become true');
}

function mount(payload, { url = 'https://herramientas.test/analisis', fetch, analyst = '', permission = 'default' } = {}) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM('<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="app"></div></body></html>', {
        url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
    });
    const window = dom.window;
    window.document.getElementById('app').dataset.payload = JSON.stringify(payload);
    if (analyst) window.localStorage.setItem('analisis:analyst', JSON.stringify(analyst));
    const notifications = [];
    class FakeNotification {
        static permission = permission;
        static async requestPermission() { this.permission = 'granted'; return 'granted'; }
        constructor(title, options) { notifications.push({ title, options }); }
    }
    window.Notification = FakeNotification;
    window.fetch = fetch;
    window.eval(bundle);
    return { dom, window, document: window.document, notifications, errors };
}

const payload = { page: 'analisis', analisis: { authenticated: true, configured: true, refreshSeconds: 45 } };
const row = (assignment = '10:0') => ({ id: '250001', assignment, name: 'PERSONA DE PRUEBA', dni: '12345678', cuit: '20123456786', state: 'Revisión de riesgo' });

test('DOM: initial load, notification opt-in, reassignment, no duplicates, failure recovery and logout', async () => {
    let current = [row()];
    let fail = false;
    let snapshots = 0;
    const requests = [];
    const app = mount(payload, { analyst: 'dmontaña', fetch: async (url, options) => {
        requests.push({ url, options });
        if (url === '/api/analisis/analysts') return response({ analysts: [{ username: 'dmontaña', name: 'Analista de prueba' }] });
        if (url.startsWith('/api/analisis/snapshot?')) {
            snapshots++;
            return fail ? response({ message: 'Sin conexión con Vimarx' }, 503) : response({ updated_at: '2026-09-10T11:00:00-03:00', items: current });
        }
        if (url === '/analisis/logout') return response({ ok: true });
        throw new Error(`Unexpected fetch: ${url}`);
    } });
    try {
        await until(() => app.document.querySelector('.analysis-dni'));
        assert.equal(app.document.querySelector('.analysis-dni').textContent, '12345678');
        assert.equal(app.notifications.length, 0);
        assert.equal(app.document.querySelector('.analysis-badge'), null);
        const link = app.document.querySelector('.analysis-open');
        assert.equal(link.target, '_blank');
        assert.match(link.href, /\/credixsa#cuit=20123456786/);
        app.document.querySelector('.analysis-notifications button').click();
        await until(() => app.document.querySelector('.analysis-enabled'));
        current = [row('20:0')];
        app.window.dispatchEvent(new app.window.Event('online'));
        await until(() => app.notifications.length === 1);
        assert.match(app.notifications[0].title, /250001/);
        await until(() => app.document.querySelector('.analysis-badge'));
        app.window.dispatchEvent(new app.window.Event('online'));
        await until(() => snapshots >= 3);
        await sleep(20);
        assert.equal(app.notifications.length, 1);
        fail = true;
        app.window.dispatchEvent(new app.window.Event('online'));
        await until(() => app.document.querySelector('[role="alert"]'));
        assert.equal(app.document.querySelector('.analysis-dni').textContent, '12345678');
        fail = false; current = [];
        app.document.querySelector('[role="alert"] button').click();
        await until(() => app.document.body.textContent.includes('No hay solicitudes pendientes'));
        assert.equal(app.document.querySelector('[role="alert"]'), null);
        app.document.querySelector('.analysis-topbar button').click();
        await until(() => requests.some((request) => request.url === '/analisis/logout'));
        assert.equal(requests.find((request) => request.url === '/analisis/logout').options.headers['X-CSRF-TOKEN'], 'csrf-test');
        assert.equal(app.errors.filter((message) => !message.includes('navigation')).length, 0);
    } finally { app.dom.window.close(); }
});

test('DOM: denied notification permission still displays assignments and switching analysts clears the previous list', async () => {
    const app = mount(payload, { analyst: 'dmontaña', permission: 'denied', fetch: async (url) => {
        if (url === '/api/analisis/analysts') return response({ analysts: [{ username: 'dmontaña', name: 'Uno' }, { username: 'otro', name: 'Dos' }] });
        return response({ updated_at: '2026-09-10T11:00:00-03:00', items: url.endsWith('analyst=otro') ? [] : [row()] });
    } });
    try {
        await until(() => app.document.querySelector('.analysis-dni'));
        assert.match(app.document.body.textContent, /Notificaciones bloqueadas/);
        const select = app.document.querySelector('select');
        select.value = 'otro'; select.dispatchEvent(new app.window.Event('change', { bubbles: true }));
        await until(() => app.document.body.textContent.includes('No hay solicitudes pendientes'));
        assert.equal(app.document.querySelector('.analysis-dni'), null);
        assert.equal(app.notifications.length, 0);
    } finally { app.dom.window.close(); }
});

test('DOM: Credixsa deep link preloads fields and submits once without user typing', async () => {
    const requests = [];
    const app = mount({ page: 'credixsa', branding: {}, tools: [{ id: 'consulta-quiebra-credix', endpoint: '/api/tools/consulta-quiebra-credix' }] }, {
        url: 'https://herramientas.test/credixsa#cuit=20123456786&nombre=PERSONA+DE+PRUEBA',
        fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return response({ status: 'none', message: 'Sin coincidencias' }); },
    });
    try {
        await until(() => requests.length > 0);
        await sleep(50);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.cuit, '20123456786');
        assert.equal(requests[0].body.nombre, 'PERSONA DE PRUEBA');
        assert.equal(app.window.location.hash, '');
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});

test('DOM: logged-out page never fetches analyst or application data', async () => {
    const app = mount({ page: 'analisis', analisis: { authenticated: false, configured: true } }, { fetch: () => assert.fail('No data should be requested') });
    try {
        await until(() => app.document.querySelector('input[type="password"]'));
        assert.equal(app.document.querySelector('select'), null);
        assert.equal(app.document.querySelector('input').autocomplete, 'current-password');
    } finally { app.dom.window.close(); }
});
