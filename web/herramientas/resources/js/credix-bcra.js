// Both sources share the same display contract. Existing CredixSA cache entries
// may omit the situation on subsequent rows of a merged HTML cell.
export function prepareCredixBcra(bcra = {}) {
    bcra = bcra || {};
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

export function reportCuit(result, normalized) {
    for (const value of [normalized?.persona?.cuit, result?.cuit]) {
        const digits = String(value ?? '').replace(/\D/g, '');
        if (/^\d{11}$/.test(digits)) return digits;
    }
    return '';
}
