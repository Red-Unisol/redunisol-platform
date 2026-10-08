// Both sources share the same display contract. Existing CredixSA cache entries
// may omit the situation on subsequent rows of a merged HTML cell.
export function prepareCredixBcra(bcra = {}) {
    bcra = bcra || {};
    if (bcra.fuente === 'BCRA') {
        const unknown = array(bcra.deudas_vigentes).some((row) => !bcraSituation(row?.situacion));
        return unknown ? { ...bcra, deuda_situacion_negativa_total: null } : bcra;
    }
    let groupSituation = '';
    const debts = (Array.isArray(bcra.deudas_vigentes) ? bcra.deudas_vigentes : []).map((row) => {
        const raw = Array.isArray(row.raw) ? row.raw : [];
        if (/^[1-6]$/.test(String(raw[0] ?? ''))) groupSituation = String(raw[0]);
        const inherited = raw.length && !/^\d/.test(String(raw[0])) ? groupSituation : '';
        return { ...row, situacion: row.situacion || inherited };
    });
    let negative = 0;
    let complete = debts.length > 0 || amountInCents(bcra.deuda_vigente_total) === 0;
    for (const row of debts) {
        const cents = amountInCents(row.monto);
        if (!/^[1-6]$/.test(String(row.situacion)) || cents === null) {
            complete = false;
        } else if (Number(row.situacion) >= 2) {
            negative += cents;
        }
    }
    return {
        ...bcra,
        fuente: 'CredixSA',
        deudas_vigentes: debts,
        deuda_situacion_negativa_total: complete && Number.isSafeInteger(negative) ? formatCents(negative) : null,
    };
}

// Keep the original value in the report; only 1..6 are credit classifications.
export function bcraSituation(value) {
    const text = String(value ?? '').trim();
    return /^[1-6]$/.test(text) ? text : null;
}

export function formatBcraSituation(value) {
    return bcraSituation(value) ?? 'N/D';
}

function amountInCents(value) {
    const text = String(value ?? '').replace(/^\$\s*/, '').trim();
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(text)) return null;
    const amount = Math.round(Number(text.replaceAll('.', '').replace(',', '.')) * 100);
    return Number.isSafeInteger(amount) ? amount : null;
}

function formatCents(value) {
    return '$ ' + (value / 100).toLocaleString('es-AR', {
        minimumFractionDigits: value % 100 ? 2 : 0,
        maximumFractionDigits: 2,
    });
}

// Calendar months relative to the newest period in this snapshot, not the query date.
const MONTH_NUMBERS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const LATEST_SITUATION_TOLERANCE_MONTHS = 2;

export function latestBcraSituations(bcra = {}) {
    bcra = bcra || {};
    const latestByEntity = new Map();
    const currentDebts = array(bcra.deudas_vigentes);
    const hasCurrentSnapshot = Array.isArray(bcra.deudas_vigentes)
        && (currentDebts.length > 0 || amountInCents(bcra.deuda_vigente_total) === 0);
    const entityKey = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const currentEntities = new Set(currentDebts.map((row) =>
        entityKey(String(row?.entidad ?? '').trim().replace(/\s+/g, ' '))));
    let reference = null;
    const observePeriod = (period) => {
        if (period !== null) reference = Math.max(reference ?? period, period);
    };
    const add = (entity, period, situation) => {
        observePeriod(period);
        const name = String(entity ?? '').trim().replace(/\s+/g, ' ');
        const value = bcraSituation(situation);
        if (!name || period === null || value === null) return;
        const key = entityKey(name);
        // The current endpoint determines which entities remain reported as debts.
        // History can recover a classification, but cannot revive an inactive debt.
        if (hasCurrentSnapshot && !currentEntities.has(key)) return;
        const previous = latestByEntity.get(key);
        if (!previous || period > previous.month) {
            latestByEntity.set(key, { entidad: name, month: period, situacion: value });
        }
    };
    // Current records take precedence if two representations have the same period.
    for (const row of currentDebts) {
        if (row) add(row.entidad, periodMonth(row.periodo), row.situacion);
    }
    const matrix = bcra.deudas_24_meses || {};
    const months = array(matrix.meses);
    const periods = [];
    let index = 0;
    for (const group of array(matrix.anios)) {
        if (!group || !/^\d{4}$/.test(String(group.anio))) continue;
        const span = Number(group.span);
        if (!Number.isInteger(span) || span < 1 || span > months.length - index) break;
        for (let offset = 0; offset < span; offset++, index++) {
            const month = MONTH_NUMBERS[String(months[index]).trim().toLowerCase()];
            const period = month ? Number(group.anio) * 12 + month - 1 : null;
            periods.push(period);
            observePeriod(period);
        }
    }
    for (const row of array(matrix.filas)) {
        if (!row) continue;
        array(row.situaciones).forEach((value, i) => add(row.entidad, periods[i] ?? null, value));
    }
    // Older snapshots may only have the evolution table, or only current debts.
    for (const row of array(bcra.evolucion_deuda_por_entidad?.filas)) {
        if (!row) continue;
        const period = periodMonth(row.periodo);
        observePeriod(period);
        for (const cell of array(row.celdas)) {
            if (cell) add(cell.entidad, period, cell.situacion);
        }
    }
    const from = reference === null ? null : reference - LATEST_SITUATION_TOLERANCE_MONTHS;
    const latest = [...latestByEntity.values()];
    return {
        periodo_referencia: monthLabel(reference),
        periodo_desde: monthLabel(from),
        filas: latest.filter((row) => row.month >= from)
            .sort((a, b) => a.entidad.localeCompare(b.entidad, 'es'))
            .map(({ month, ...row }) => ({ ...row, periodo: monthLabel(month) })),
        entidades_fuera_de_ventana: latest.filter((row) => row.month < from).length,
    };
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function periodMonth(value) {
    const text = String(value ?? '').trim();
    const split = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(text);
    const compact = /^(\d{4})-?(\d{2})$/.exec(text);
    if (!split && !compact) return null;
    const year = Number(split ? split[2] : compact[1]);
    const month = Number(split ? split[1] : compact[2]);
    return year >= 1900 && month >= 1 && month <= 12 ? year * 12 + month - 1 : null;
}

function monthLabel(month) {
    return month === null ? null : `${String(month % 12 + 1).padStart(2, '0')}/${Math.floor(month / 12)}`;
}
