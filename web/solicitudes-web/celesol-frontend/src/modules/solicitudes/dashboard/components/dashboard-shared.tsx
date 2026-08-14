/* eslint-disable react-refresh/only-export-components */

import type { CSSProperties, ReactNode } from "react";

const ESTADO_STYLES: Record<string, [string, string, string]> = {
  "Carga Vendedor": ["#FFF0E8", "#E87722", "#FDBA74"],
  Motor: ["#F3F4F6", "#6B7280", "#D1D5DB"],
  "Revisión Riesgo": ["#EFF6FF", "#1D4ED8", "#BFDBFE"],
  "Pre Aprobada": ["#F0FDF4", "#16A34A", "#BBF7D0"],
  Confirmada: ["#DCFCE7", "#15803D", "#86EFAC"],
  Revisar: ["#FFFBEB", "#D97706", "#FDE68A"],
  Liquidada: ["#D1FAE5", "#065F46", "#6EE7B7"],
  Transferir: ["#EDE9FE", "#6D28D9", "#C4B5FD"],
  Rechazada: ["#FEF2F2", "#DC2626", "#FECACA"],
  Desestimada: ["#FFF7ED", "#C2410C", "#FED7AA"],
  Vencida: ["#F9FAFB", "#6B7280", "#E5E7EB"],
};

export function EstadoBadge({ estado }: { estado: string }) {
  const [bg, color, border] = ESTADO_STYLES[estado] ?? [
    "#F3F4F6",
    "#6B7280",
    "#D1D5DB",
  ];
  return (
    <span
      style={{
        background: bg,
        color,
        border: `1px solid ${border}`,
        borderRadius: 3,
        padding: "1px 5px",
        fontSize: 10,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {estado}
    </span>
  );
}

type BarRowProps = {
  label: string;
  value: number | string;
  color: string;
  pct: string;
  labelW?: number;
  valueW?: number;
  valueColor?: string;
  bold?: boolean;
  italic?: boolean;
  mb?: number;
};

export function BarRow({
  label,
  value,
  color,
  pct,
  labelW = 120,
  valueW = 24,
  valueColor = "#555",
  bold,
  italic,
  mb = 7,
}: BarRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: mb,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: italic ? "#9CA3AF" : "#444",
          width: labelW,
          flexShrink: 0,
          fontStyle: italic ? "italic" : undefined,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          background: "#EAEAEA",
          borderRadius: 2,
          height: 18,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: color,
            width: pct,
            height: "100%",
            borderRadius: "0 2px 2px 0",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          color: valueColor,
          width: valueW,
          textAlign: "right",
          fontWeight: bold ? 600 : undefined,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

type KpiCardProps = {
  label: string;
  value: string;
  sub?: ReactNode;
  valueColor?: string;
  border?: string;
  dot?: string;
  hero?: boolean;
};

export function KpiCard({
  label,
  value,
  sub,
  valueColor = "#1a1a1a",
  border = "1px solid #e0e0e0",
  dot,
  hero,
}: KpiCardProps) {
  return (
    <div
      style={{
        background: "white",
        border: hero ? "none" : border,
        borderLeft: hero ? "4px solid var(--role-color)" : undefined,
        borderRadius: 4,
        padding: hero ? "13px 13px 13px 11px" : 13,
        position: "relative",
        boxShadow: hero ? "0 1px 4px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      {dot && !hero && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 7,
            height: 7,
            background: dot,
            borderRadius: "50%",
          }}
        />
      )}
      <div
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: ".4px",
          color: "#bbb",
          fontWeight: 600,
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: hero ? 32 : 26,
          color: hero ? "var(--role-color)" : valueColor,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ fontSize: 10, color: "#bbb", marginTop: 5 }}>{sub}</div>
      )}
    </div>
  );
}

export const TH: CSSProperties = {
  textAlign: "left",
  padding: "5px 7px",
  fontSize: 10,
  fontWeight: 600,
  color: "#bbb",
  textTransform: "uppercase",
};
export const TD: CSSProperties = { padding: "6px 7px" };
export const TDsm: CSSProperties = { padding: "5px 7px" };
export const TBODY_ROW: CSSProperties = { borderBottom: "1px solid #f5f5f5" };

export const SEL: CSSProperties = {
  border: "1px solid #e0e0e0",
  borderRadius: 3,
  padding: "2px 7px",
  fontSize: 12,
  background: "white",
  color: "#333",
  height: 26,
};
export const BTN_APPLY: CSSProperties = {
  background: "#E87722",
  color: "white",
  border: "none",
  borderRadius: 3,
  padding: "2px 14px",
  fontSize: 12,
  cursor: "pointer",
  height: 26,
  fontWeight: 500,
  marginLeft: "auto",
};
export const BTN_CLEAR: CSSProperties = {
  background: "white",
  color: "#666",
  border: "1px solid #ddd",
  borderRadius: 3,
  padding: "2px 10px",
  fontSize: 12,
  cursor: "pointer",
  height: 26,
};

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "#F2F2F0",
        borderRadius: 4,
        padding: "8px 13px",
        display: "flex",
        gap: 7,
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: 13,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12">
        <path
          d="M1 3h10M3 6.5h6M5 10h2"
          stroke="#bbb"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
      {children}
      <button type="button" style={BTN_APPLY}>
        Aplicar
      </button>
      <button type="button" style={BTN_CLEAR}>
        Limpiar
      </button>
    </div>
  );
}
