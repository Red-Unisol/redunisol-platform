import assert from 'node:assert/strict';
import test from 'node:test';
import { webFormAttempt, forgetWebFormAttempt } from '../../resources/js/lib/web-form-attempt.ts';

test('a double submit, reload and retry retain one request without storing the answers', async () => {
    const storage = new Map();
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    });
    try {
        const landing = '/prestamos';
        const answers = 'synthetic fixture, private answers';
        const [one, two] = await Promise.all([webFormAttempt(landing, answers), webFormAttempt(landing, answers)]);
        assert.equal(one, two);
        assert.equal(storage.size, 1);
        assert.equal([...storage.values()][0].includes(answers), false);
        const freshPage = await import('../../resources/js/lib/web-form-attempt.ts?reload');
        assert.equal(await freshPage.webFormAttempt(landing, answers), one);
        const changed = await webFormAttempt(landing, answers + ' edited');
        assert.notEqual(changed, one);
        forgetWebFormAttempt(landing);
        assert.notEqual(await webFormAttempt(landing, answers + ' edited'), changed);
        forgetWebFormAttempt(landing);
    } finally {
        delete globalThis.sessionStorage;
    }
});
