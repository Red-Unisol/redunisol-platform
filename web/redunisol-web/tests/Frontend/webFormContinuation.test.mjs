import assert from 'node:assert/strict';
import test from 'node:test';
import { withWebFormReference } from '../../resources/js/utils/webFormContinuation.ts';

const reference = 'a'.repeat(32);
test('the successful web form preserves the WhatsApp destination and appends one reference', () => {
    for (const link of [
        'https://wa.me/5493510000000?text=Hola%2C%20ya%20complet%C3%A9%20el%20formulario',
        'https://api.whatsapp.com/send?phone=5493510000000&text=Hola',
    ]) {
        const original = new URL(link);
        const result = new URL(withWebFormReference(link, reference));
        assert.equal(result.host, original.host);
        assert.equal(result.pathname, original.pathname);
        assert.equal(result.searchParams.get('phone'), original.searchParams.get('phone'));
        assert.equal(result.searchParams.get('text'), `${original.searchParams.get('text')} (solicitud: ${reference})`);
        assert.equal(withWebFormReference(result.href, reference), result.href);
    }
});
test('non WhatsApp links, missing references and invalid references remain usable', () => {
    const regular = 'https://redunisol.com.ar/otra-pagina';
    assert.equal(withWebFormReference(regular, reference), regular);
    assert.equal(withWebFormReference('https://wa.me/5493510000000', null), 'https://wa.me/5493510000000');
    assert.equal(withWebFormReference('javascript:alert(1)', reference), 'javascript:alert(1)');
    assert.equal(withWebFormReference('https://wa.me/5493510000000', 'invalid'), 'https://wa.me/5493510000000');
});
