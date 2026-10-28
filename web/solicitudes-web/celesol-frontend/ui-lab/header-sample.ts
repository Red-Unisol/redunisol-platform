/** Fictional data shared by header previews and the isolated real-page harness. */
export const SAMPLE_REQUEST = {
  id: "00000000-0000-4000-8000-000000000001",
  number: "500001",
  name: "MARÍA EJEMPLO",
  member: "DEMO-0241",
  amount: 600000,
  cuotas: 12,
  line: "AMEJUCA RECURRENTE ESPECIAL",
  firstDue: "30/11/2026",
  cancellations: 0,
  installment: 101658.01,
  expenses: 60000,
  capital: 660000,
  total: 1219896.14,
} as const;

export const INSTALLMENTS = [
  "30/11/2026",
  "31/12/2026",
  "31/01/2027",
  "28/02/2027",
  "31/03/2027",
  "30/04/2027",
  "31/05/2027",
  "30/06/2027",
  "31/07/2027",
  "31/08/2027",
  "30/09/2027",
  "31/10/2027",
].map((date, index) => ({
  number: index + 1,
  date,
  amount: index < 11 ? 101658.01 : 101658.03,
}));
