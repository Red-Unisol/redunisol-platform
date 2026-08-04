/* eslint-disable react-refresh/only-export-components */

import type { CSSProperties, ReactNode } from "react";

import { StyledSelect } from "@/modules/solicitudes-editor/components/fields/base";
import type { StyledSelectOption } from "@/modules/solicitudes-editor/types";
import { Button } from "@/shared/components/ui/button";

const ESTADO_HUMANIZE: Record<string, string> = {
  CargaVendedor: "Carga Vendedor",
  RevisionRiesgo: "Revisión Riesgo",
  PreAprobada: "Pre Aprobada",
  VerificacionFirma: "Verif. Firma",
};

export function humanEstado(e: string): string {
  return ESTADO_HUMANIZE[e] ?? e;
}

const ESTADO_STYLES: Record<string, [string, string, string]> = {
  "Carga Vendedor": ["#FFF4EE", "#D96015", "#FDBA74"],
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
  const label = humanEstado(estado);
  const [bg, color, border] = ESTADO_STYLES[label] ?? [
    "#F3F4F6",
    "#6B7280",
    "#D1D5DB",
  ];
  return (
    <span
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        color,
        display: "inline-block",
        fontSize: 10,
        fontWeight: 500,
        lineHeight: "16px",
        padding: "0 6px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// Placeholder para gráficos de dona sin datos: un aro fantasma (mismo
// tamaño/posición que la dona real, para no generar salto de layout al
// pasar de vacío a lleno) con un ícono de pie-chart centrado. Mismo
// layout centrado en los 4 dashboards, sin excepciones.
function GhostDonutRing() {
  return (
    <svg height={72} viewBox="0 0 72 72" width={72}>
      <circle
        cx={36}
        cy={36}
        fill="none"
        r={28}
        stroke="#E5E7EB"
        strokeDasharray="5 5"
        strokeWidth={9}
      />
      <g transform="translate(24, 24)">
        <circle
          cx={12}
          cy={12}
          fill="none"
          r={9}
          stroke="#D1D5DB"
          strokeWidth={1.8}
        />
        <path
          d="M12 3v9l7.79 4.5"
          fill="none"
          stroke="#D1D5DB"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      </g>
    </svg>
  );
}

export function ChartEmptyState({
  description,
  height = 176,
  message,
}: {
  description?: string;
  height?: number;
  message: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        height,
        justifyContent: "center",
      }}
    >
      <GhostDonutRing />
      <span
        style={{
          color: "#6B7280",
          fontSize: 12,
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {message}
      </span>
      {description != null && (
        <span
          style={{
            color: "#9CA3AF",
            fontSize: 11,
            maxWidth: 220,
            textAlign: "center",
          }}
        >
          {description}
        </span>
      )}
    </div>
  );
}

type BarRowProps = {
  animDelay?: number;
  bold?: boolean;
  color: string;
  italic?: boolean;
  label: string;
  labelW?: number;
  mb?: number;
  pct: string;
  pctLabel?: string;
  value: number | string;
  valueColor?: string;
  valueW?: number;
};

export function BarRow({
  animDelay,
  bold,
  color,
  italic,
  label,
  labelW = 130,
  mb = 8,
  pct,
  pctLabel,
  value,
  valueColor = "#374151",
  valueW = 28,
}: BarRowProps) {
  const shouldAnimate = animDelay != null && !italic && pct !== "0%";
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: 8,
        marginBottom: mb,
      }}
    >
      <span
        style={{
          color: italic ? "#C4C9D4" : "#4B5563",
          flexShrink: 0,
          fontSize: 12,
          fontStyle: italic ? "italic" : undefined,
          fontWeight: bold ? 600 : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: labelW,
        }}
      >
        {label}
      </span>
      <div
        style={{
          background: "#F1F3F6",
          borderRadius: 3,
          flex: 1,
          height: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            animation: shouldAnimate
              ? `barSlide 0.55s ease-out ${animDelay}ms both`
              : undefined,
            background: color,
            borderRadius: "0 3px 3px 0",
            height: "100%",
            opacity: italic ? 0.25 : 1,
            transformOrigin: "left",
            transition: "width 0.4s ease",
            width: pct,
          }}
        />
      </div>
      <span
        style={{
          color: italic ? "#C4C9D4" : valueColor,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          textAlign: "right",
          width: valueW,
        }}
      >
        {value}
      </span>
      {pctLabel != null && (
        <span
          style={{
            color: "#9CA3AF",
            fontSize: 11,
            textAlign: "right",
            width: 36,
          }}
        >
          {pctLabel}
        </span>
      )}
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderRadius: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          animation: "skelPulse 1.4s ease-in-out infinite",
          background: "#F1F3F6",
          borderRadius: 3,
          height: 9,
          marginBottom: 10,
          width: "60%",
        }}
      />
      <div
        style={{
          animation: "skelPulse 1.4s ease-in-out infinite 0.12s",
          background: "#F1F3F6",
          borderRadius: 3,
          height: 24,
          width: "38%",
        }}
      />
      <div
        style={{
          animation: "skelPulse 1.4s ease-in-out infinite 0.06s",
          background: "#F1F3F6",
          borderRadius: 3,
          height: 8,
          marginTop: 8,
          width: "78%",
        }}
      />
    </div>
  );
}

export function SkeletonBar({
  width = "60%",
  delay = 0,
}: {
  delay?: number;
  width?: string;
}) {
  return (
    <div
      style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: 7 }}
    >
      <div
        style={{
          animation: `skelPulse 1.4s ease-in-out infinite ${delay}ms`,
          background: "#F1F3F6",
          borderRadius: 3,
          flexShrink: 0,
          height: 9,
          width: 110,
        }}
      />
      <div
        style={{
          animation: `skelPulse 1.4s ease-in-out infinite ${delay + 60}ms`,
          background: "#F1F3F6",
          borderRadius: 3,
          flex: 1,
          height: 12,
        }}
      >
        <div
          style={{
            animation: `skelPulse 1.4s ease-in-out infinite ${delay}ms`,
            background: "#E5E7EB",
            borderRadius: 3,
            height: "100%",
            width,
          }}
        />
      </div>
      <div
        style={{
          animation: `skelPulse 1.4s ease-in-out infinite ${delay + 30}ms`,
          background: "#F1F3F6",
          borderRadius: 3,
          flexShrink: 0,
          height: 9,
          width: 24,
        }}
      />
    </div>
  );
}

type KpiCardProps = {
  accentColor?: string;
  dot?: string;
  label: string;
  sub?: ReactNode;
  value: string;
};

export function KpiCard({ accentColor, dot, label, sub, value }: KpiCardProps) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderLeft: accentColor
          ? `3px solid ${accentColor}`
          : "1px solid #E8EAED",
        borderRadius: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        padding: "16px 18px",
        position: "relative",
      }}
    >
      {dot != null && (
        <div
          style={{
            background: dot,
            borderRadius: "50%",
            height: 7,
            position: "absolute",
            right: 10,
            top: 10,
            width: 7,
          }}
        />
      )}
      <div
        style={{
          color: "#9CA3AF",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.5px",
          marginBottom: 8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: accentColor ?? "#111827",
          fontSize: 28,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          letterSpacing: "-0.5px",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

type AttentionItemProps = {
  actionLabel?: string;
  color: string;
  count: number | string;
  label: string;
};

export function AttentionItem({
  actionLabel,
  color,
  count,
  label,
}: AttentionItemProps) {
  const active = typeof count === "number" ? count > 0 : true;
  const dotColor = active ? color : "#D1D5DB";
  const badgeBg = active ? `${color}18` : "#F3F4F6";
  const badgeBorder = active ? `${color}33` : "#E5E7EB";
  const badgeColor = active ? color : "#9CA3AF";
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: 8,
        padding: "5px 0",
      }}
    >
      <span
        style={{
          background: dotColor,
          borderRadius: "50%",
          flexShrink: 0,
          height: 7,
          width: 7,
        }}
      />
      <span
        style={{ color: active ? "#374151" : "#9CA3AF", flex: 1, fontSize: 12 }}
      >
        {label}
      </span>
      <span
        style={{
          background: badgeBg,
          border: `1px solid ${badgeBorder}`,
          borderRadius: 12,
          color: badgeColor,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          minWidth: 28,
          padding: "1px 8px",
          textAlign: "center",
        }}
      >
        {count}
      </span>
      {actionLabel != null && (
        <span
          onMouseEnter={(e) => (e.currentTarget.style.color = "#374151")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#9CA3AF")}
          style={{
            color: "#9CA3AF",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
            transition: "color 0.15s",
            userSelect: "none",
          }}
        >
          {actionLabel}
        </span>
      )}
    </div>
  );
}

export const TH: CSSProperties = {
  color: "#9CA3AF",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.4px",
  padding: "6px 10px",
  textAlign: "left",
  textTransform: "uppercase",
};

export const TD: CSSProperties = { padding: "9px 10px" };
export const TBODY_ROW: CSSProperties = { borderBottom: "1px solid #F3F4F6" };

export function DashboardFilterSelect({
  emptyOptionLabel,
  onChange,
  options,
  placeholder,
  value,
}: {
  emptyOptionLabel?: string;
  onChange: (v: string) => void;
  options: StyledSelectOption[];
  placeholder?: string;
  value: string;
}) {
  return (
    <div style={{ minWidth: 130 }}>
      <StyledSelect
        emptyOptionLabel={emptyOptionLabel}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

export function FilterBar({
  children,
  onApply,
  onClear,
}: {
  children: ReactNode;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderRadius: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 12,
        padding: "10px 16px",
      }}
    >
      <svg height="13" viewBox="0 0 13 13" width="13" style={{ flexShrink: 0 }}>
        <path
          d="M1.5 3.5h10M3.5 6.5h6M5.5 9.5h2"
          stroke="#9CA3AF"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
      <span
        style={{
          color: "#9CA3AF",
          fontSize: 11,
          fontWeight: 500,
          marginRight: 2,
        }}
      >
        Filtros
      </span>
      {children}
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        <Button onClick={onClear} size="sm" type="button" variant="outline">
          Limpiar
        </Button>
        <Button onClick={onApply} size="sm" type="button">
          Aplicar
        </Button>
      </div>
    </div>
  );
}
