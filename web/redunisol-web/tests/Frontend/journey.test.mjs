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
        unavailable = false,
        paused = false;
    const pending = [];
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
        TextEncoder,
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
            const response = {
                status: unavailable ? 503 : 202,
                json: async () => ({ accepted: payload.events.length }),
            };
            if (paused)
                return new Promise((resolve) =>
                    pending.push(() => resolve(response)),
                );
            return response;
        },
    });
    vm.runInContext(code, context);
    return {
        ...context.exports,
        requests,
        listeners,
        timers,
        location,
        pause: () => {
            paused = true;
        },
        respond: (index) => pending[index](),
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
    const firstPage = randomUUID(),
        secondPage = randomUUID();
    f.initializeJourney(firstPage);
    assert.equal(f.getJourneyPageId(), firstPage);
    f.listeners.get('journey:navigate')({ detail: firstPage });
    f.location.href = 'https://redunisol.com.ar/policias';
    f.location.pathname = '/policias';
    f.listeners.get('journey:navigate')({ detail: secondPage });
    await f.flushJourney();
    assert.equal(f.requests[0].payload.events.length, 2);
    assert.equal(f.requests[0].payload.events[1].page_id, secondPage);
    assert.equal(
        f.requests[0].payload.events[1].referrer,
        'https://redunisol.com.ar/jubilados?utm_id=123&msclkid=abc',
    );
    assert.equal(f.journeyUrl('javascript:alert(1)'), '');
});

test('flushes pending exit events while another batch is in flight and acknowledges by ID', async () => {
    const f = fixture();
    f.initializeJourney();
    f.pause();
    const first = f.flushJourney();
    f.trackJourney('form.submit', { step: 4 });
    const second = f.flushJourney(true);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].payload.events[0].type, 'page.view');
    assert.equal(f.requests[1].payload.events[0].type, 'form.submit');
    // The exit request can be acknowledged before the periodic request.
    f.respond(1);
    await second;
    f.respond(0);
    await first;
    await f.flushJourney();
    assert.equal(f.requests.length, 2);
});

test('never records authentication routes or password reset tokens', async () => {
    const f = fixture();
    f.location.href = 'https://redunisol.com.ar/reset-password/private-token';
    f.location.pathname = '/reset-password/private-token';
    f.initializeJourney();
    f.trackJourney('page.leave');
    await f.flushJourney();
    assert.equal(f.requests.length, 0);
    assert.equal(f.journeyUrl(f.location.href), '');
});
