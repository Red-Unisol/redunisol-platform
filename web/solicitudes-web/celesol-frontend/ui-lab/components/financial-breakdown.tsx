import { INSTALLMENTS, money, SAMPLE_REQUEST } from "../scenarios";

export function FinancialBreakdown() {
  return (
    <details className="lab-financial-breakdown">
      <summary>Ver desglose y plan de cuotas</summary>
      <div className="lab-breakdown-body">
        <dl className="lab-breakdown-totals">
          <div>
            <dt>Gastos administrativos</dt>
            <dd>{money(SAMPLE_REQUEST.expenses)}</dd>
          </div>
          <div>
            <dt>Capital financiado</dt>
            <dd>{money(SAMPLE_REQUEST.capital)}</dd>
          </div>
          <div>
            <dt>Total del cálculo</dt>
            <dd>{money(SAMPLE_REQUEST.total)}</dd>
          </div>
        </dl>
        <p>
          Los gastos administrativos están incluidos en el capital financiado.
        </p>
        <div className="lab-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cuota</th>
                <th>Vencimiento</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              {INSTALLMENTS.map((row) => (
                <tr key={row.number}>
                  <td>{row.number}</td>
                  <td>{row.date}</td>
                  <td>{money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
