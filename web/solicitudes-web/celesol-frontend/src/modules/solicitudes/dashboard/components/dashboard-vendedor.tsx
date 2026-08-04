import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartEmptyState,
  DashboardFilterSelect,
  EstadoBadge,
  FilterBar,
  TBODY_ROW,
  TD,
  TH,
} from "@/modules/dashboard/admin/components/admin-dashboard-shared";

import { DateInput } from "@/shared/components/ui/date-input";

import { useDashboardVendedorStatsQuery } from "../hooks/use-dashboard-vendedor-stats-query";
import {
  DEFAULT_VENDEDOR_DASHBOARD_FILTERS,
  type VendedorDashboardFilters,
} from "../types";

// ── Color tokens ───────────────────────────────────────────────────────────────
const BRAND = "#E87722";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Chart palettes ────────────────────────────────────────────────────────────
const ESTADO_COLORS = [
  "#F59E0B",
  "#FCD34D",
  "#60A5FA",
  "#A78BFA",
  "#34D399",
  "#059669",
  "#065F46",
  "#EF4444",
  "#9CA3AF",
];
const FUNNEL_COLORS = ["#3B82F6", "#8B5CF6", "#F59E0B", "#10B981", "#059669"];
const LINEA_COLORS = ["#059669", BRAND, "#3B82F6", "#D1D5DB"];

// ── Draft / filter wiring ─────────────────────────────────────────────────────
type DraftFilters = { fechaDesde: string; fechaHasta: string; linea: string };

function draftToApiFilters(draft: DraftFilters): VendedorDashboardFilters {
  return {
    fechaDesde: draft.fechaDesde,
    fechaHasta: draft.fechaHasta,
    linea: draft.linea,
  };
}

const DEFAULT_DRAFT: DraftFilters = {
  fechaDesde: DEFAULT_VENDEDOR_DASHBOARD_FILTERS.fechaDesde,
  fechaHasta: DEFAULT_VENDEDOR_DASHBOARD_FILTERS.fechaHasta,
  linea: "",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtM(v: number) {
  return v >= 1_000_000
    ? `$ ${(v / 1_000_000).toFixed(2).replace(".", ",")}M`
    : `$ ${v.toLocaleString("es-AR")}`;
}
function pct(a: number, b: number) {
  return b === 0 ? "0%" : `${Math.round((a / b) * 100)}%`;
}

// ── Local primitives ───────────────────────────────────────────────────────────
function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        padding: "24px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({
  action,
  children,
  sub,
}: {
  action?: ReactNode;
  children: ReactNode;
  sub?: string;
}) {
  return (
    <div
      style={{
        alignItems: "flex-start",
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <div>
        <div style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>
          {children}
        </div>
        {sub != null && (
          <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
            {sub}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

function VendKpiCard({
  badge,
  badgeBg,
  badgeColor,
  iconBg,
  iconEl,
  label,
  value,
  valueColor,
}: {
  badge: string;
  badgeBg: string;
  badgeColor: string;
  iconBg: string;
  iconEl: ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        alignItems: "flex-start",
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        display: "flex",
        flex: 1,
        gap: 16,
        padding: "20px 20px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: iconBg,
          borderRadius: 10,
          display: "flex",
          flexShrink: 0,
          height: 44,
          justifyContent: "center",
          marginTop: 1,
          width: 44,
        }}
      >
        {iconEl}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title zone — fixed height for 2 lines so value always aligns */}
        <div
          style={{
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            color: "#9CA3AF",
            display: "-webkit-box",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.5px",
            lineHeight: 1.3,
            marginBottom: 8,
            minHeight: "2.6em",
            overflow: "hidden",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        {/* Value — always 1 line */}
        <div
          style={{
            color: valueColor ?? "#111827",
            fontSize: 26,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.5px",
            lineHeight: 1,
            marginBottom: 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </div>
        {/* Badge — capped to 1 line */}
        <span
          style={{
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 1,
            background: badgeBg,
            borderRadius: 5,
            color: badgeColor,
            display: "-webkit-box",
            fontSize: 10,
            fontWeight: 500,
            lineHeight: 1.3,
            overflow: "hidden",
            padding: "3px 8px",
          }}
        >
          {badge}
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function DashboardVendedor() {
  const [draft, setDraft] = useState<DraftFilters>(DEFAULT_DRAFT);
  const [appliedFilters, setAppliedFilters] =
    useState<VendedorDashboardFilters>(DEFAULT_VENDEDOR_DASHBOARD_FILTERS);
  const set = (key: keyof DraftFilters) => (v: string) =>
    setDraft((p) => ({ ...p, [key]: v }));
  const handleApply = () => setAppliedFilters(draftToApiFilters(draft));
  const handleClear = () => {
    setDraft(DEFAULT_DRAFT);
    setAppliedFilters(DEFAULT_VENDEDOR_DASHBOARD_FILTERS);
  };

  const statsQuery = useDashboardVendedorStatsQuery(appliedFilters);
  const stats = statsQuery.data;
  const hasLoadError = statsQuery.isError;

  const totalSolicitudesPorEstado = (stats?.solicitudesPorEstado ?? []).reduce(
    (s, d) => s + d.count,
    0,
  );
  const estadoChartData = (stats?.solicitudesPorEstado ?? []).map((d, i) => ({
    name: d.estado,
    value: d.count,
    color: ESTADO_COLORS[i % ESTADO_COLORS.length],
  }));
  const funnelChartData = (stats?.funnel ?? []).map((f, i) => ({
    label: f.estado,
    value: f.count,
    step: String(i + 1).padStart(2, "0"),
  }));
  const totalLiquidado = (stats?.montosPorLinea ?? []).reduce(
    (s, l) => s + l.monto,
    0,
  );
  const funnelIniciadas = stats?.funnel[0]?.count ?? 0;
  const funnelLiquidadas = stats?.funnel[4]?.count ?? 0;
  const conversionPct =
    funnelIniciadas > 0
      ? Math.round((funnelLiquidadas / funnelIniciadas) * 100)
      : 0;
  const montoEnGestion = (stats?.pendientes ?? []).reduce(
    (s, p) => s + p.monto,
    0,
  );
  const pendientesUrgentes = (stats?.pendientes ?? []).filter(
    (p) => p.diasActiva >= 6,
  ).length;

  return (
    <div
      style={{
        color: "#111827",
        fontFamily: "system-ui,-apple-system,sans-serif",
        fontSize: 13,
        margin: "0 auto",
        maxWidth: 1280,
        padding: "20px 28px 48px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            color: "#9CA3AF",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.3px",
            marginBottom: 4,
            textTransform: "uppercase",
          }}
        >
          Solicitudes · Vendedor
        </div>
        <h1
          style={{
            color: "#111827",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.3px",
            margin: "0 0 4px",
          }}
        >
          Mi dashboard comercial
        </h1>
        <p style={{ color: "#6B7280", fontSize: 12, margin: 0 }}>
          Tus ventas, conversión y calidad de cartera en un vistazo.
        </p>
      </div>

      {/* Filters */}
      <FilterBar onApply={handleApply} onClear={handleClear}>
        <DateInput
          max={draft.fechaHasta || undefined}
          onChange={set("fechaDesde")}
          style={{ width: 130 }}
          value={draft.fechaDesde}
        />
        <DateInput
          max={today()}
          min={draft.fechaDesde || undefined}
          onChange={set("fechaHasta")}
          style={{ width: 130 }}
          value={draft.fechaHasta}
        />
        <DashboardFilterSelect
          emptyOptionLabel="Todas"
          onChange={set("linea")}
          options={(stats?.filterOptions.lineas ?? []).map((l) => ({
            label: l,
            value: l,
          }))}
          placeholder="Línea"
          value={draft.linea}
        />
      </FilterBar>

      {hasLoadError && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            color: "#DC2626",
            fontSize: 12,
            marginBottom: 12,
            marginTop: 12,
            padding: "10px 14px",
          }}
        >
          No se pudieron cargar tus estadísticas. Probá actualizar la página.
        </div>
      )}

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          marginBottom: 12,
        }}
      >
        {[
          <VendKpiCard
            badge="acreditado en el período"
            badgeBg="#ECFDF5"
            badgeColor="#059669"
            iconBg="#ECFDF5"
            iconEl={
              <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
                <path
                  d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                  stroke="#059669"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            }
            label="Monto liquidado"
            value={stats ? fmtM(stats.kpis.montoLiquidado) : "—"}
            valueColor="#059669"
          />,
          <VendKpiCard
            badge="por transferir"
            badgeBg="#FFFBEB"
            badgeColor="#D97706"
            iconBg="#FFFBEB"
            iconEl={
              <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="#D97706"
                  strokeWidth="1.8"
                />
                <path
                  d="M12 6v6l4 2"
                  stroke="#D97706"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            }
            label="Aprobado sin liquidar"
            value={stats ? fmtM(stats.kpis.aprobadoSinLiquidar) : "—"}
            valueColor="#D97706"
          />,
          <VendKpiCard
            badge="en el período"
            badgeBg="#EFF6FF"
            badgeColor="#3B82F6"
            iconBg="#EFF6FF"
            iconEl={
              <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
                <path
                  d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                  stroke="#3B82F6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M14 2v6h6M12 18v-4M10 16h4"
                  stroke="#3B82F6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            }
            label="Solicitudes iniciadas"
            value={stats ? String(stats.kpis.solicitudesIniciadas) : "—"}
          />,
          <VendKpiCard
            badge="Carga → acreditación"
            badgeBg="#F5F3FF"
            badgeColor="#7C3AED"
            iconBg="#F5F3FF"
            iconEl={
              <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
                <rect
                  height="18"
                  rx="2"
                  ry="2"
                  stroke="#7C3AED"
                  strokeWidth="1.8"
                  width="18"
                  x="3"
                  y="4"
                />
                <path
                  d="M16 2v4M8 2v4M3 10h18"
                  stroke="#7C3AED"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            }
            label="Tiempo promedio"
            value={
              stats?.kpis.tiempoPromedioDiasLiquidacion != null
                ? `${Math.round(stats.kpis.tiempoPromedioDiasLiquidacion)} días`
                : "Sin datos"
            }
          />,
        ].map((card, i) => (
          <div key={i} style={{ display: "flex" }}>
            {card}
          </div>
        ))}
      </div>

      {/* Evolución — full width, últimos 6 meses */}
      {(() => {
        const data = stats?.evolucionMensual ?? [];
        const hasVentas = data.some((m) => m.monto > 0);
        const yFmt = (v: number) =>
          v >= 1_000_000
            ? `$${(v / 1_000_000).toFixed(1)}M`
            : `$${Math.round(v / 1_000)}K`;
        const bestMonth = data.reduce<
          { periodo: string; monto: number } | undefined
        >((best, m) => (!best || m.monto > best.monto ? m : best), undefined);
        const avgMonto =
          data.length > 0
            ? data.reduce((s, m) => s + m.monto, 0) / data.length
            : 0;
        const previous = data[data.length - 2];
        const last = data[data.length - 1];
        const vsAnterior =
          previous && previous.monto > 0 && last
            ? `${(((last.monto - previous.monto) / previous.monto) * 100).toFixed(1).replace(".", ",")}%`
            : "—";
        const footer = [
          {
            label: "Mejor mes",
            value: bestMonth
              ? `${bestMonth.periodo} — ${fmtM(bestMonth.monto)}`
              : "—",
            color: "#059669",
          },
          {
            label: "Promedio",
            value: `${fmtM(avgMonto)} / mes`,
            color: "#374151",
          },
          { label: "vs. mes anterior", value: vsAnterior, color: "#3B82F6" },
        ];

        return (
          <Card style={{ marginBottom: 12 }}>
            <CardTitle sub="monto liquidado por mes">
              Evolución de ventas
            </CardTitle>
            <ResponsiveContainer height={200} width="100%">
              <AreaChart
                data={data}
                margin={{ bottom: 0, left: 0, right: 8, top: 4 }}
              >
                <defs>
                  <linearGradient id="gradVend" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor={BRAND} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={BRAND} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#F1F3F6"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="periodo"
                  style={{ fontSize: 10 }}
                  tick={{ fill: "#9CA3AF" }}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  domain={hasVentas ? undefined : [0, 1]}
                  style={{ fontSize: 10 }}
                  tick={{ fill: "#9CA3AF" }}
                  tickFormatter={yFmt}
                  tickLine={false}
                  ticks={hasVentas ? undefined : [0]}
                  width={44}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const val = payload[0]?.value;
                    return (
                      <div
                        style={{
                          background: "#FFF",
                          border: "1px solid #E8EAED",
                          borderRadius: 8,
                          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                          padding: "10px 14px",
                        }}
                      >
                        <div
                          style={{
                            color: "#6B7280",
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                        >
                          {String(label)}
                        </div>
                        <div
                          style={{
                            color: BRAND,
                            fontSize: 14,
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 700,
                          }}
                        >
                          {typeof val === "number" ? fmtM(val) : "—"}
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  dataKey="monto"
                  dot={false}
                  fill="url(#gradVend)"
                  stroke={BRAND}
                  strokeWidth={2.5}
                  type="monotone"
                  activeDot={{
                    fill: BRAND,
                    r: 4,
                    stroke: "#FFF",
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
            <div
              style={{
                borderTop: "1px solid #F3F4F6",
                display: "flex",
                justifyContent: "space-between",
                marginTop: 12,
                paddingTop: 12,
              }}
            >
              {footer.map(({ label, value, color }) => (
                <div key={label}>
                  <div
                    style={{
                      color: "#9CA3AF",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.4px",
                      textTransform: "uppercase",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      color,
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      marginTop: 2,
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Charts row: Donut | Embudo */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 12,
        }}
      >
        {/* Solicitudes por estado — barras horizontales */}
        <Card>
          <CardTitle sub="distribución actual de mi cartera">
            Solicitudes por estado
          </CardTitle>
          {estadoChartData.length === 0 ? (
            <div
              style={{
                alignItems: "center",
                color: "#9CA3AF",
                display: "flex",
                fontSize: 12,
                height: 220,
                justifyContent: "center",
              }}
            >
              Sin solicitudes en el período
            </div>
          ) : (
            <ResponsiveContainer height={220} width="100%">
              <BarChart
                barCategoryGap="20%"
                barSize={16}
                data={estadoChartData}
                layout="vertical"
                margin={{ bottom: 0, left: 0, right: 28, top: 4 }}
              >
                <XAxis axisLine={false} hide type="number" />
                <YAxis
                  axisLine={false}
                  dataKey="name"
                  style={{ fontSize: 10 }}
                  tick={{ fill: "#4B5563" }}
                  tickLine={false}
                  type="category"
                  width={110}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const raw = payload[0]?.value;
                    const val = typeof raw === "number" ? raw : 0;
                    const color =
                      (payload[0]?.payload as { color?: string })?.color ??
                      "#374151";
                    return (
                      <div
                        style={{
                          background: "#FFF",
                          border: "1px solid #E8EAED",
                          borderRadius: 8,
                          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                          padding: "10px 14px",
                        }}
                      >
                        <div
                          style={{
                            color: "#6B7280",
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                        >
                          {String(payload[0]?.name ?? "")}
                        </div>
                        <div
                          style={{
                            color,
                            fontSize: 14,
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 700,
                          }}
                        >
                          {val}
                        </div>
                        <div
                          style={{
                            color: "#9CA3AF",
                            fontSize: 11,
                            marginTop: 2,
                          }}
                        >
                          {pct(val, totalSolicitudesPorEstado)} del total
                        </div>
                      </div>
                    );
                  }}
                  cursor={{ fill: "#F9FAFB" }}
                />
                <Bar
                  dataKey="value"
                  label={{ fill: "#9CA3AF", fontSize: 10, position: "right" }}
                  radius={[0, 4, 4, 0]}
                >
                  {estadoChartData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div
            style={{
              borderTop: "1px solid #F3F4F6",
              marginTop: 4,
              paddingTop: 10,
            }}
          >
            <span
              style={{
                color: "#111827",
                fontSize: 13,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
              }}
            >
              {totalSolicitudesPorEstado}
            </span>
            <span style={{ color: "#9CA3AF", fontSize: 11, marginLeft: 5 }}>
              solicitudes en cartera actual
            </span>
          </div>
        </Card>

        {/* Embudo de solicitudes — donut horizontal */}
        <Card>
          <CardTitle sub="período seleccionado">
            Embudo de solicitudes
          </CardTitle>
          {funnelIniciadas === 0 ? (
            <ChartEmptyState
              description="Cuando haya solicitudes pendientes vas a ver la distribución acá."
              height={176}
              message="Sin solicitudes en el período seleccionado"
            />
          ) : (
            <>
              {/* Body: donut izquierda + leyenda derecha */}
              <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
                <div style={{ flexShrink: 0 }}>
                  <PieChart height={160} width={160}>
                    <Pie
                      cx={80}
                      cy={80}
                      data={funnelChartData}
                      dataKey="value"
                      innerRadius={46}
                      isAnimationActive={false}
                      nameKey="label"
                      outerRadius={76}
                      paddingAngle={2}
                      stroke="none"
                    >
                      <Label
                        content={({ viewBox }) => {
                          const { cx = 0, cy = 0 } = (viewBox ?? {}) as {
                            cx?: number;
                            cy?: number;
                          };
                          return (
                            <g>
                              <text
                                dominantBaseline="middle"
                                fill="#111827"
                                fontSize={15}
                                fontWeight={700}
                                textAnchor="middle"
                                x={cx}
                                y={cy - 7}
                              >
                                {conversionPct}%
                              </text>
                              <text
                                dominantBaseline="middle"
                                fill="#9CA3AF"
                                fontSize={9}
                                textAnchor="middle"
                                x={cx}
                                y={cy + 9}
                              >
                                conversión
                              </text>
                            </g>
                          );
                        }}
                      />
                      {funnelChartData.map((_, i) => (
                        <Cell key={i} fill={FUNNEL_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const raw = payload[0]?.value;
                        const val = typeof raw === "number" ? raw : 0;
                        const idx = funnelChartData.findIndex(
                          (d) => d.label === String(payload[0]?.name ?? ""),
                        );
                        const color = FUNNEL_COLORS[idx] ?? "#374151";
                        return (
                          <div
                            style={{
                              background: "#FFF",
                              border: "1px solid #E8EAED",
                              borderRadius: 8,
                              boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                              padding: "10px 14px",
                            }}
                          >
                            <div
                              style={{
                                color: "#6B7280",
                                fontSize: 11,
                                marginBottom: 4,
                              }}
                            >
                              {String(payload[0]?.name ?? "")}
                            </div>
                            <div
                              style={{
                                color,
                                fontSize: 14,
                                fontVariantNumeric: "tabular-nums",
                                fontWeight: 700,
                              }}
                            >
                              {val}
                            </div>
                            <div
                              style={{
                                color: "#9CA3AF",
                                fontSize: 11,
                                marginTop: 2,
                              }}
                            >
                              {pct(val, funnelIniciadas)} de iniciadas
                            </div>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </div>
                {/* Leyenda con columnas alineadas */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {funnelChartData.map((d, i) => (
                    <div
                      key={d.label}
                      style={{
                        alignItems: "center",
                        display: "flex",
                        gap: 7,
                        marginBottom: i < funnelChartData.length - 1 ? 9 : 0,
                      }}
                    >
                      <span
                        style={{
                          background: FUNNEL_COLORS[i],
                          borderRadius: 2,
                          flexShrink: 0,
                          height: 8,
                          width: 8,
                        }}
                      />
                      <span
                        style={{
                          color: "#4B5563",
                          flex: 1,
                          fontSize: 11,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {d.label}
                      </span>
                      <span
                        style={{
                          color: "#9CA3AF",
                          fontSize: 11,
                          textAlign: "right",
                          width: 34,
                        }}
                      >
                        {pct(d.value, funnelIniciadas)}
                      </span>
                      <span
                        style={{
                          color: "#111827",
                          fontSize: 11,
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 600,
                          textAlign: "right",
                          width: 20,
                        }}
                      >
                        {d.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Footer pill conversión */}
              <div
                style={{
                  borderTop: "1px solid #F3F4F6",
                  marginTop: 12,
                  paddingTop: 10,
                }}
              >
                <span
                  style={{
                    background: "#ECFDF5",
                    borderRadius: 6,
                    color: "#059669",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "4px 12px",
                  }}
                >
                  Conversión: {conversionPct}% · {funnelLiquidadas} de{" "}
                  {funnelIniciadas} iniciadas liquidadas
                </span>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Bottom row: Top pendientes | Líneas vendidas */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "3fr 2fr" }}>
        {/* Top solicitudes pendientes */}
        <Card>
          <CardTitle
            action={
              <a
                href="/solicitudes/core/recientes"
                style={{
                  color: BRAND,
                  fontSize: 11,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Ver todas →
              </a>
            }
            sub="casos que requieren tu atención"
          >
            Top solicitudes pendientes
          </CardTitle>
          <table
            style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
                <th style={TH}>Titular</th>
                <th style={TH}>Línea</th>
                <th style={TH}>Estado</th>
                <th style={{ ...TH, textAlign: "right" }}>Monto</th>
                <th style={{ ...TH, textAlign: "right" }}>Antigüedad</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.pendientes ?? []).map((p, i, arr) => {
                const urgente = p.diasActiva >= 6;
                return (
                  <tr
                    key={p.id}
                    style={{
                      ...(i < arr.length - 1 ? TBODY_ROW : {}),
                      background: urgente ? "#FFFBEB" : undefined,
                    }}
                  >
                    <td style={TD}>
                      <span style={{ fontWeight: 500 }}>{p.titular}</span>
                    </td>
                    <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                      {p.linea}
                    </td>
                    <td style={TD}>
                      <EstadoBadge estado={p.estado} />
                    </td>
                    <td
                      style={{
                        ...TD,
                        color: "#374151",
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                      }}
                    >
                      {fmtM(p.monto)}
                    </td>
                    <td
                      style={{
                        ...TD,
                        color: urgente ? "#D97706" : "#9CA3AF",
                        fontSize: 11,
                        fontWeight: urgente ? 600 : undefined,
                        textAlign: "right",
                      }}
                    >
                      {p.diasActiva} {p.diasActiva === 1 ? "día" : "días"}
                      {urgente ? " ⚠" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stats && stats.pendientes.length === 0 && (
            <div
              style={{
                color: "#9CA3AF",
                fontSize: 12,
                padding: "12px 0",
                textAlign: "center",
              }}
            >
              No tenés solicitudes pendientes
            </div>
          )}
          <div
            style={{
              borderTop: "1px solid #F3F4F6",
              marginTop: 12,
              paddingTop: 12,
            }}
          >
            <div style={{ alignItems: "baseline", display: "flex", gap: 6 }}>
              <span
                style={{
                  color: "#111827",
                  fontSize: 20,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtM(montoEnGestion)}
              </span>
              <span style={{ color: "#9CA3AF", fontSize: 11 }}>en gestión</span>
            </div>
            <div style={{ color: "#6B7280", fontSize: 11, marginTop: 4 }}>
              {pendientesUrgentes} con urgencia{" "}
              <span style={{ color: "#D97706", fontWeight: 600 }}>
                ⚠ más de 6 días sin avance
              </span>
            </div>
          </div>
        </Card>

        {/* Líneas vendidas */}
        <Card>
          <CardTitle sub="monto liquidado por línea de préstamo">
            Líneas vendidas
          </CardTitle>
          {(stats?.montosPorLinea ?? []).map((l, i, arr) => {
            const color = LINEA_COLORS[i % LINEA_COLORS.length];
            return (
              <div
                key={l.linea}
                style={{ marginBottom: i < arr.length - 1 ? 16 : 0 }}
              >
                <div
                  style={{
                    alignItems: "baseline",
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 5,
                  }}
                >
                  <span style={{ color: "#374151", fontSize: 11 }}>
                    {l.linea}
                  </span>
                  <span
                    style={{
                      color,
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                    }}
                  >
                    {l.monto > 0 ? fmtM(l.monto) : "$ 0"}
                  </span>
                </div>
                <div
                  style={{
                    background: "#F1F3F6",
                    borderRadius: 3,
                    height: 12,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      background: color,
                      borderRadius: "0 3px 3px 0",
                      height: "100%",
                      width:
                        totalLiquidado > 0
                          ? pct(l.monto, totalLiquidado)
                          : "0%",
                    }}
                  />
                </div>
                <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
                  {l.count > 0
                    ? `${l.count} liquidada${l.count > 1 ? "s" : ""} · ${pct(l.monto, totalLiquidado)} del total`
                    : "sin liquidaciones — en proceso"}
                </div>
              </div>
            );
          })}
          {stats && stats.montosPorLinea.length === 0 && (
            <div style={{ color: "#9CA3AF", fontSize: 12 }}>
              Sin préstamos liquidados en el período
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
