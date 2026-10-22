import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(
        new URL('../../resources/js/utils/journey.ts', import.meta.url),
        'utf8',
    ),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    },
).outputText;

function fixture() {
    const requests = [],
        listeners = new Map(),
        timers = [];
    let clock = Date.now(),
        unavailable = false;
    const location = {
        href: 'https://redunisol.com.ar/jubilados?utm_id=123&msclkid=abc&email=secret',
        pathname: '/jubilados',
    };
    const target = {
        addEventListener: (name, callback) => listeners.set(name, callback),
    };
    const context = vm.createContext({
        exports: {},
        crypto: { randomUUID },
        URL,
        URLSearchParams,
        location,
        Date: class extends Date {
            static now() {
                return clock;
            }
        },
        window: { ...target, setInterval: (callback) => timers.push(callback) },
        document: {
            ...target,
            referrer: 'https://google.com/',
            visibilityState: 'visible',
        },
        fetch: async (url, options) => {
            const payload = JSON.parse(options.body);
            requests.push({ url, ...options, payload });
            return {
                status: unavailable ? 503 : 202,
                json: async () => ({ accepted: payload.events.length }),
            };
        },
    });
    vm.runInContext(code, context);
    return {
        ...context.exports,
        requests,
        listeners,
        timers,
        location,
        fail: (value) => {
            unavailable = value;
        },
        advance: () => {
            clock += 70000;
        },
    };
}

test('coalesces browser events into one acknowledged batch with stable source fields', async () => {
    const f = fixture();
    f.initializeJourney();
    for (let i = 0; i < 8; i++) f.trackJourney('form.step', { step: 1 });
    assert.equal(f.requests.length, 0);
    await f.flushJourney();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].payload.events.length, 9);
    assert.equal(f.requests[0].keepalive, true);
    assert.equal(
        f.requests[0].payload.events[0].url,
        'https://redunisol.com.ar/jubilados?utm_id=123&msclkid=abc',
    );
});

test('keeps event IDs on retry and respects backoff during a storage outage', async () => {
    const f = fixture();
    f.initializeJourney();
    f.fail(true);
    await f.flushJourney();
    const id = f.requests[0].payload.events[0].event_id;
    await f.flushJourney();
    assert.equal(f.requests.length, 1);
    f.advance();
    f.fail(false);
    await f.flushJourney();
    assert.equal(f.requests[1].payload.events[0].event_id, id);
    await f.flushJourney();
    assert.equal(f.requests.length, 2);
});

test('deduplicates initial Inertia navigation and keeps each subsequent page origin', async () => {
    const f = fixture();
    f.initializeJourney();
    f.listeners.get('journey:navigate')();
    f.location.href = 'https://redunisol.com.ar/policias';
    f.location.pathname = '/policias';
    f.listeners.get('journey:navigate')();
    await f.flushJourney();
    assert.equal(f.requests[0].payload.events.length, 2);
    assert.equal(
        f.requests[0].payload.events[1].referrer,
        'https://redunisol.com.ar/jubilados?utm_id=123&msclkid=abc',
    );
    assert.equal(f.journeyUrl('javascript:alert(1)'), '');
});
