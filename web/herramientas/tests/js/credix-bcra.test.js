import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCredixBcra, bcraSituation, formatBcraSituation } from '../../resources/js/credix-bcra.js';

test('CredixSA: incluye todas las entidades de una situación agrupada y excluye situación 1', () => {
    const report = { deudas_vigentes: [
        { entidad: 'Santander', situacion: '5', monto: '878.000', raw: ['5', '8.0%', 'Santander'] },
        { entidad: 'Credikot', situacion: '', monto: '478.000', raw: ['Credikot', '06 / 2026', '478.000'] },
        { entidad: 'Cordoba', situacion: '1', monto: '15.602.000', raw: ['1', '92.0%', 'Cordoba'] },
    ] };
    const original = JSON.stringify(report);
    const prepared = prepareCredixBcra(report);
    assert.equal(prepared.fuente, 'CredixSA');
    assert.equal(prepared.deudas_vigentes[1].situacion, '5');
    assert.equal(prepared.deuda_situacion_negativa_total, '$ 1.356.000');
    assert.equal(JSON.stringify(report), original);
});

test('situación 2, decimales, cero real y datos desconocidos', () => {
    const total = (deudas_vigentes) => prepareCredixBcra({ deudas_vigentes }).deuda_situacion_negativa_total;
    assert.equal(total([{ situacion: '2', monto: '$ 1.000,50' }, { situacion: '6', monto: '1,25' }]), '$ 1.001,75');
    assert.equal(total([{ situacion: '1', monto: '500' }]), '$ 0');
    assert.equal(total([{ situacion: '2', monto: 'N/D' }]), null);
    assert.equal(total([{ situacion: '', monto: '500' }]), null);
    assert.equal(total([]), null);
    assert.equal(prepareCredixBcra({ deudas_vigentes: [], deuda_vigente_total: '$ 0' }).deuda_situacion_negativa_total, '$ 0');
    assert.equal(prepareCredixBcra(null).deuda_situacion_negativa_total, null);
});

test('el informe precalentado conserva la fuente BCRA, los ceros y sus totales', () => {
    const report = { fuente: 'BCRA', deudas_vigentes: [], deuda_vigente_total: '$ 0',
        deuda_situacion_negativa_total: '$ 0', consultado_en: '2026-09-17T12:00:00Z' };
    assert.deepEqual(prepareCredixBcra(report), report);
});

test('situación desconocida no es normal ni un subtotal de riesgo completo, incluso en cache BCRA anterior', () => {
    for (const value of [0, '0', null, 'N/D', '']) {
        const report = { fuente: 'BCRA', deuda_vigente_total: '$ 500', deuda_situacion_negativa_total: '$ 0',
            deudas_vigentes: [{ entidad: 'Banco', situacion: value, monto: '$ 500' }] };
        const original = JSON.stringify(report);
        const prepared = prepareCredixBcra(report);
        assert.equal(prepared.deuda_situacion_negativa_total, null);
        assert.equal(prepared.deuda_vigente_total, '$ 500');
        assert.equal(prepared.deudas_vigentes[0].situacion, value);
        assert.equal(JSON.stringify(report), original);
    }
    assert.equal(prepareCredixBcra({ deudas_vigentes: [{ situacion: '0', monto: '$ 500' }] })
        .deuda_situacion_negativa_total, null);
});

test('solo las situaciones 1..6 son calificaciones; los valores ausentes o inválidos se muestran N/D', () => {
    for (const value of [0, '0', ' 0 ', null, undefined, '', '-', 'N/D', 7, -1, 1.5]) {
        assert.equal(bcraSituation(value), null);
        assert.equal(formatBcraSituation(value), 'N/D');
    }
    for (let value = 1; value <= 6; value++) {
        assert.equal(bcraSituation(value), String(value));
        assert.equal(formatBcraSituation(` ${value} `), String(value));
    }
});
