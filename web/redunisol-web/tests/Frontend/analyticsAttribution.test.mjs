import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(
        new URL(
            '../../resources/js/utils/analyticsAttribution.ts',
            import.meta.url,
        ),
        'utf8',
    ),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    },
).outputText;

function fixture(options = {}) {
    const requests = [];
    const timers = new Map();
    let timerId = 0;
    const browser = {
        dataLayer: [],
        setTimeout: (callback) => {
            timers.set(++timerId, callback);
            return timerId;
        },
        clearTimeout: (id) => timers.delete(id),
        ...options,
    };
    const context = vm.createContext({
        window: browser,
        exports: {},
        fetch: async (url, request) =>
            requests.push({
                url,
                ...request,
                payload: JSON.parse(request.body),
            }),
    });
    vm.runInContext(code, context);
    return {
        capture: context.exports.captureAnalyticsAttribution,
        browser,
        requests,
        timers,
    };
}

test('uses official get callbacks and sends only valid existing IDs', async () => {
    const calls = [];
    const f = fixture({
        gtag: (...args) => {
            calls.push(args.slice(0, 3));
            args[3](args[2] === 'client_id' ? '123.456' : 1791469719);
        },
    });
    await f.capture('G-RENEBND2BG');
    assert.deepEqual(calls, [
        ['get', 'G-RENEBND2BG', 'client_id'],
        ['get', 'G-RENEBND2BG', 'session_id'],
    ]);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0].payload, {
        ga_client_id: '123.456',
        ga_session_id: '1791469719',
    });
    assert.equal(f.requests[0].url, '/api/attribution/analytics');
    assert.equal(f.requests[0].credentials, 'same-origin');
    assert.equal(f.timers.size, 0);
});

test('uses the existing GTM command queue without configuring a second tag', async () => {
    const f = fixture();
    const pending = f.capture('G-RENEBND2BG');
    assert.equal(f.browser.dataLayer.length, 2);
    for (const command of f.browser.dataLayer) {
        assert.equal(
            Object.prototype.toString.call(command),
            '[object Arguments]',
        );
        assert.equal(command[0], 'get');
        command[3](command[2] === 'client_id' ? '123.456' : '222');
    }
    await pending;
    assert.equal(f.requests.length, 1);
});

test('unavailable analytics expires without persistence or blocking other actions', async () => {
    const f = fixture();
    const pending = f.capture('G-RENEBND2BG');
    assert.equal(f.requests.length, 0);
    for (const callback of [...f.timers.values()]) callback();
    await pending;
    assert.equal(f.requests.length, 0);
});

test('preserves the client when the optional session is unavailable', async () => {
    const f = fixture({
        gtag: (_command, _target, field, callback) =>
            callback(field === 'client_id' ? '123.456' : undefined),
    });
    await f.capture('G-RENEBND2BG');
    assert.deepEqual(f.requests[0].payload, { ga_client_id: '123.456' });
});

test('missing tag or invalid client never creates analytics IDs', async () => {
    for (const options of [
        { dataLayer: undefined },
        {
            gtag: (_command, _target, _field, callback) =>
                callback('not-an-id'),
        },
        {
            gtag: () => {
                throw new Error('blocked');
            },
        },
    ]) {
        const f = fixture(options);
        await f.capture('G-RENEBND2BG');
        assert.equal(f.requests.length, 0);
    }
});
