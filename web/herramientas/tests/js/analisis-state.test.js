import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInbox, credixLink, credixPrefill, readSaved, save } from '../../resources/js/analisis-state.js';

const item = (id, assignment = '10:0') => ({ id, assignment, name: 'Persona de prueba', cuit: '20123456786', dni: '12345678' });

test('initial backlog is silent, subsequent arrivals notify only once', () => {
    const initial = reconcileInbox(null, [item('1')]);
    assert.deepEqual(initial.arrivals, []);
    const next = reconcileInbox(initial.state, [item('1'), item('2')]);
    assert.deepEqual(next.arrivals.map((entry) => entry.id), ['2']);
    assert.deepEqual(next.state.unread, ['2']);
    assert.deepEqual(reconcileInbox(next.state, [item('1'), item('2')]).arrivals, []);
    assert.equal(JSON.stringify(next.state).includes('Persona'), false);
});

test('returning to the same analyst detects reassignment between polls or visits', () => {
    const saved = reconcileInbox(null, [item('1')]).state;
    const returning = reconcileInbox(JSON.parse(JSON.stringify(saved)), [item('1', '30:0')]);
    assert.equal(returning.arrivals.length, 1);
    assert.equal(reconcileInbox(returning.state, [item('1', '30:40')]).arrivals.length, 1);
});

test('leaving the inbox removes the item, returning alerts even with unchanged signature', () => {
    const saved = reconcileInbox(null, [item('1')]).state;
    const empty = reconcileInbox(saved, []).state;
    assert.deepEqual(empty.assignments, {});
    assert.equal(reconcileInbox(empty, [item('1')]).arrivals.length, 1);
});

test('eligible state changes do not alert and unread markers disappear on removal', () => {
    const saved = reconcileInbox(null, []).state;
    const arrival = reconcileInbox(saved, [item('1')]).state;
    assert.equal(reconcileInbox(arrival, [{ ...item('1'), state: 'Confirmada' }]).arrivals.length, 0);
    assert.deepEqual(reconcileInbox(arrival, []).state.unread, []);
});

test('opening another tab with the persisted baseline does not replay notifications', () => {
    const shared = reconcileInbox(reconcileInbox(null, []).state, [item('1')]).state;
    const otherTab = reconcileInbox(shared, [item('1')]);
    assert.equal(otherTab.arrivals.length, 0);
    assert.deepEqual(otherTab.state.unread, ['1']);
});

test('Credixsa link carries identifier and name in fragment, supports DNI fallback and accents', () => {
    const link = credixLink({ ...item('1'), name: 'MUÑOZ, ANA & MARÍA' });
    assert.equal(link.split('#')[0], '/credixsa');
    assert.deepEqual(credixPrefill(link.slice(link.indexOf('#'))), { cuit: '20123456786', nombre: 'MUÑOZ, ANA & MARÍA' });
    assert.equal(credixPrefill(credixLink({ ...item('1'), cuit: '0' }).split('#')[1]).cuit, '12345678');
    assert.deepEqual(credixPrefill(''), { cuit: '', nombre: '' });
    assert.equal(credixPrefill('#cuit=abc123').cuit, '');
});

test('unavailable or malformed browser storage does not break the inbox', () => {
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(readSaved(denied, 'key'), null);
    assert.equal(save(denied, 'key', {}), false);
    assert.equal(readSaved({ getItem: () => 'invalid' }, 'key'), null);
});
