import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCredixBcra, latestBcraSituations } from '../../resources/js/credix-bcra.js';

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

const snapshot = (fuente = 'BCRA') => ({
    fuente,
    deudas_vigentes: [{ entidad: 'Banco Agosto', periodo: '08/2026', situacion: '1', monto: '$ 100' }],
    deudas_24_meses: { anios: [{ anio: '2026', span: 4 }], meses: ['Ago', 'Jul', 'Jun', 'May'], filas: [
        { entidad: 'Banco Agosto', situaciones: ['1', '2', '3', '-'] },
        { entidad: 'Banco Julio', situaciones: ['N/D', '4', '1', '-'] },
        { entidad: 'Banco Junio', situaciones: ['-', '', '0', '1'] },
        { entidad: 'Banco Mayo', situaciones: ['-', '-', '-', '5'] },
    ] },
});

for (const source of ['BCRA', 'CredixSA']) {
    test(`${source}: último período individual, tolerancia inclusiva de dos meses y situación cero`, () => {
        const input = snapshot(source);
        const original = JSON.stringify(input);
        const result = latestBcraSituations(input);
        assert.equal(result.periodo_referencia, '08/2026');
        assert.equal(result.periodo_desde, '06/2026');
        assert.deepEqual(result.filas, [
            { entidad: 'Banco Agosto', situacion: '1', periodo: '08/2026' },
            { entidad: 'Banco Julio', situacion: '4', periodo: '07/2026' },
            { entidad: 'Banco Junio', situacion: '0', periodo: '06/2026' },
        ]);
        assert.equal(result.entidades_fuera_de_ventana, 1);
        assert.equal(JSON.stringify(input), original);
    });
}

test('la ventana cruza de enero a diciembre y noviembre sin depender del día de consulta', () => {
    const result = latestBcraSituations({
        deudas_24_meses: { anios: [{ anio: '2027', span: 1 }, { anio: '2026', span: 3 }],
            meses: ['Ene', 'Dic', 'Nov', 'Oct'], filas: [
                { entidad: 'Diciembre', situaciones: ['-', '2', '1', '-'] },
                { entidad: 'Noviembre', situaciones: ['-', '-', '3', '-'] },
                { entidad: 'Octubre', situaciones: ['-', '-', '-', '4'] },
            ] },
    });
    assert.equal(result.periodo_referencia, '01/2027');
    assert.equal(result.periodo_desde, '11/2026');
    assert.deepEqual(result.filas.map((r) => r.periodo), ['12/2026', '11/2026']);
    assert.equal(result.entidades_fuera_de_ventana, 1);
});

test('usa el período más nuevo aunque las filas estén desordenadas y no duplica entidades', () => {
    const result = latestBcraSituations({ deudas_vigentes: [
        { entidad: ' Banco Córdoba ', periodo: '06 / 2026', situacion: '5' },
        { entidad: 'BANCO CORDOBA', periodo: '202608', situacion: 0 },
    ], evolucion_deuda_por_entidad: { filas: [
        { periodo: '07/2026', celdas: [{ entidad: 'Banco Córdoba', situacion: '4' }] },
        { periodo: '08/2026', celdas: [{ entidad: 'BANCO CORDOBA', situacion: '0' }] },
    ] } });
    assert.deepEqual(result.filas, [{ entidad: 'BANCO CORDOBA', situacion: '0', periodo: '08/2026' }]);
});

test('admite snapshots anteriores con solo vigentes o solo evolución, sin fabricar situaciones', () => {
    const result = latestBcraSituations({ evolucion_deuda_por_entidad: { filas: [
        { periodo: '2026-08', celdas: [{ entidad: 'Entidad', situacion: '2' }] },
        { periodo: '06/2026', celdas: [{ entidad: 'Otra entidad', situacion: '6' }] },
        { periodo: '08/2026', celdas: [{ entidad: 'Desconocida', situacion: 'N/D' }] },
    ] } });
    assert.equal(result.filas.length, 2);
    assert.deepEqual(latestBcraSituations({ deudas_vigentes: [
        { entidad: 'Entidad', periodo: '8/2026', situacion: '1' },
    ] }).filas, [{ entidad: 'Entidad', periodo: '08/2026', situacion: '1' }]);
});

test('no rescata entidades antiguas cuando el informe nuevo tiene celdas vacías', () => {
    const result = latestBcraSituations({ evolucion_deuda_por_entidad: { filas: [
        { periodo: '08/2026', celdas: [{ entidad: 'Vieja', situacion: '' }] },
        { periodo: '05/2026', celdas: [{ entidad: 'Vieja', situacion: '5' }] },
    ] } });
    assert.equal(result.periodo_referencia, '08/2026');
    assert.deepEqual(result.filas, []);
    assert.equal(result.entidades_fuera_de_ventana, 1);
});

test('sin datos o con períodos/situaciones inválidos no muestra información inventada', () => {
    assert.deepEqual(latestBcraSituations(null), {
        periodo_referencia: null, periodo_desde: null, filas: [], entidades_fuera_de_ventana: 0,
    });
    const result = latestBcraSituations({ deudas_vigentes: [
        null, { entidad: 'A', periodo: '13/2026', situacion: '1' },
        { entidad: 'B', periodo: 'Sin dato', situacion: '3' },
        { entidad: 'C', periodo: '08/2026', situacion: '7' },
        { entidad: 'D', periodo: '08/2026', situacion: null },
    ] });
    assert.equal(result.periodo_referencia, '08/2026');
    assert.deepEqual(result.filas, []);
});
