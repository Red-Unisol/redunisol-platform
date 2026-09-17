import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCredixBcra, reportCuit } from '../../resources/js/credix-bcra.js';

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

test('la consulta directa usa el CUIL resuelto y no envía DNI ni un nombre', () => {
    assert.equal(reportCuit({ cuit: '12345678' }, { persona: { cuit: '20-12345678-6' } }), '20123456786');
    assert.equal(reportCuit({ cuit: '12345678' }, {}), '');
    assert.equal(reportCuit({ cuit: '20123456786' }, {}), '20123456786');
});
