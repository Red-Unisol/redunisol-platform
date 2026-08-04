import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { generatePath } from "react-router-dom";

import { DateInput } from "@/shared/components/ui/date-input";

import { PERFORMANCE_MOCK } from "../mocks/performance-dashboard.mock";
import { useDashboardAdminStatsQuery } from "../hooks/use-dashboard-admin-stats-query";
import {
  DEFAULT_DASHBOARD_FILTERS,
  type DashboardAdminFilters,
} from "../types";
import {
  ChartEmptyState,
  DashboardFilterSelect,
  EstadoBadge,
  FilterBar,
  SkeletonKpi,
} from "./admin-dashboard-shared";
import {
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { PerformanceDashboardView } from "./performance-dashboard-view";

// ── Reduced-motion detection ──────────────────────────────────────────────────
function useReducedMotion(): boolean {
  return useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )[0];
}

// ── Color tokens ──────────────────────────────────────────────────────────────
const BRAND = "#E87722";

const AREA_COLORS = ["#3B82F6", "#10B981", "#FBBF24", "#94A3B8"];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Draft / filter wiring ─────────────────────────────────────────────────────
// Estado/Área/Línea dependen de datos reales (workflow_states, workflow_owners,
// líneas en uso) y se arman más abajo, en el componente, a partir de
// stats.filterOptions -- no hardcodear acá porque se desincroniza del catálogo
// real (como pasaba antes: dos estados y un área del listado viejo ni siquiera
// existían con esos valores).
type DraftFilters = {
  fechaDesde: string;
  fechaHasta: string;
  linea: string;
  estado: string;
  area: string;
  vendedorId: string;
};

function draftToApiFilters(draft: DraftFilters): DashboardAdminFilters {
  return {
    fechaDesde: draft.fechaDesde,
    fechaHasta: draft.fechaHasta,
    linea: draft.linea,
    estado: draft.estado,
    area: draft.area,
    vendedorId: draft.vendedorId,
    asignadoId: "",
  };
}

const DEFAULT_DRAFT: DraftFilters = {
  fechaDesde: DEFAULT_DASHBOARD_FILTERS.fechaDesde,
  fechaHasta: DEFAULT_DASHBOARD_FILTERS.fechaHasta,
  linea: "",
  estado: "",
  area: "",
  vendedorId: "",
};

function fmtPct(num: number, denom: number) {
  if (denom === 0) return "0%";
  return `${((num / denom) * 100).toFixed(1).replace(".", ",")}%`;
}

function fmtFecha(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${(year ?? "").slice(-2)}`;
}

function fmtFechaRange(desde: string, hasta: string): string {
  return desde === hasta
    ? fmtFecha(desde)
    : `${fmtFecha(desde)} – ${fmtFecha(hasta)}`;
}

// ── Local layout primitives ───────────────────────────────────────────────────
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

function OpKpiCard({
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
        alignItems: "center",
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        display: "flex",
        flex: 1,
        gap: 18,
        padding: "20px 22px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: iconBg,
          borderRadius: 10,
          display: "flex",
          flexShrink: 0,
          height: 52,
          justifyContent: "center",
          width: 52,
        }}
      >
        {iconEl}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: "#9CA3AF",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.6px",
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: valueColor ?? "#111827",
            fontSize: 28,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            letterSpacing: "-0.8px",
            lineHeight: 1,
            marginBottom: 10,
          }}
        >
          {value}
        </div>
        <span
          style={{
            background: badgeBg,
            borderRadius: 5,
            color: badgeColor,
            fontSize: 10,
            fontWeight: 500,
            padding: "3px 9px",
          }}
        >
          {badge}
        </span>
      </div>
    </div>
  );
}

function CardTitle({
  children,
  sub,
}: {
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>
        {children}
      </div>
      {sub != null && (
        <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function AdminDashboard() {
  const reducedMotion = useReducedMotion();
  const [draft, setDraft] = useState<DraftFilters>(DEFAULT_DRAFT);
  const [appliedFilters, setAppliedFilters] = useState<DashboardAdminFilters>(
    DEFAULT_DASHBOARD_FILTERS,
  );

  const [activeTab, setActiveTab] = useState<"operacion" | "rendimiento">(
    "operacion",
  );

  const statsQuery = useDashboardAdminStatsQuery(appliedFilters);
  const stats = statsQuery.data;
  const hasLoadError = statsQuery.isError;

  const lineaOptions = (stats?.filterOptions.lineas ?? []).map((linea) => ({
    label: linea,
    value: linea,
  }));
  const estadoOptions = (stats?.filterOptions.estados ?? []).map((estado) => ({
    label: estado.name,
    value: estado.code,
  }));
  const areaOptions = (stats?.filterOptions.areas ?? []).map((area) => ({
    label: area.name,
    value: area.code,
  }));

  const handleApply = () => setAppliedFilters(draftToApiFilters(draft));
  const handleClear = () => {
    setDraft(DEFAULT_DRAFT);
    setAppliedFilters(DEFAULT_DASHBOARD_FILTERS);
  };
  const set = (field: keyof DraftFilters) => (v: string) =>
    setDraft((d) => ({ ...d, [field]: v }));

  const creadas = stats?.kpis.creadasPeriodo ?? 0;
  const backlogActivo = stats?.kpis.backlogActivo ?? 0;

  const totalNegativos =
    (stats?.kpis.rechazadas ?? 0) +
    (stats?.kpis.desestimadas ?? 0) +
    (stats?.kpis.vencidas ?? 0);

  const fadeAt = (delayMs: number): CSSProperties =>
    reducedMotion
      ? {}
      : {
          animation: "fadeUp 0.2s ease-out both",
          animationDelay: `${delayMs}ms`,
        };

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
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 14,
          ...fadeAt(0),
        }}
      >
        <div>
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
            Solicitudes · Administración
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
            Control general
          </h1>
          <p style={{ color: "#6B7280", fontSize: 12, margin: 0 }}>
            Vista global del sistema: operación, backlog, funnel y calidad de
            datos.
          </p>
        </div>
        <button
          onClick={handleApply}
          style={{
            alignItems: "center",
            background: "transparent",
            border: "1px solid #E8EAED",
            borderRadius: 8,
            color: "#6B7280",
            cursor: "pointer",
            display: "flex",
            fontSize: 12,
            gap: 6,
            padding: "7px 12px",
          }}
          type="button"
        >
          <svg height="12" viewBox="0 0 12 12" width="12">
            <path
              d="M6 1v2M10.2 3.8l-1.4 1.4M11 6H9M10.2 8.2l-1.4-1.4M6 9v2M1.8 8.2l1.4-1.4M1 6h2M1.8 3.8l1.4 1.4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.3"
            />
          </svg>
          Actualizar
        </button>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div style={fadeAt(35)}>
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
            options={lineaOptions}
            placeholder="Línea"
            value={draft.linea}
          />
          <DashboardFilterSelect
            emptyOptionLabel="Todos"
            onChange={set("estado")}
            options={estadoOptions}
            placeholder="Estado"
            value={draft.estado}
          />
          <DashboardFilterSelect
            emptyOptionLabel="Todos"
            onChange={set("area")}
            options={areaOptions}
            placeholder="Owner / Área"
            value={draft.area}
          />
          <DashboardFilterSelect
            emptyOptionLabel="Todos"
            onChange={set("vendedorId")}
            options={(stats?.filterOptions.vendedores ?? []).map((v) => ({
              label: v.fullName,
              value: v.id,
            }))}
            placeholder="Vendedor"
            value={draft.vendedorId}
          />
        </FilterBar>
      </div>

      {hasLoadError && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            color: "#DC2626",
            fontSize: 12,
            marginBottom: 12,
            padding: "10px 14px",
          }}
        >
          No se pudieron cargar las estadísticas. Probá actualizar la página.
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div
        style={{
          borderBottom: "1px solid #E8EAED",
          display: "flex",
          gap: 0,
          marginBottom: 16,
        }}
      >
        {(["operacion"] as const).map((tab) => {
          const label = tab === "operacion" ? "Operación" : "Rendimiento";
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none",
                border: "none",
                borderBottom: isActive
                  ? `2px solid ${BRAND}`
                  : "2px solid transparent",
                color: isActive ? BRAND : "#6B7280",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                letterSpacing: isActive ? "-0.1px" : undefined,
                marginBottom: -1,
                padding: "10px 22px 12px",
                transition: "color 0.15s",
              }}
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Vista: Operación ─────────────────────────────────────────────────── */}
      {activeTab === "operacion" && (
        <>
          {/* KPIs */}
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(5,1fr)",
              marginBottom: 12,
            }}
          >
            {!stats
              ? Array.from({ length: 5 }, (_, i) => <SkeletonKpi key={i} />)
              : [
                  <OpKpiCard
                    badge={fmtFechaRange(
                      appliedFilters.fechaDesde,
                      appliedFilters.fechaHasta,
                    )}
                    badgeBg="#FFF4EE"
                    badgeColor={BRAND}
                    iconBg="#FFF4EE"
                    iconEl={
                      <svg
                        fill="none"
                        height="22"
                        viewBox="0 0 24 24"
                        width="22"
                      >
                        <path
                          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                          stroke={BRAND}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"
                          stroke={BRAND}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    }
                    label="Ingresadas en período"
                    value={String(creadas)}
                  />,
                  <OpKpiCard
                    badge="solicitudes activas"
                    badgeBg="#EFF6FF"
                    badgeColor="#3B82F6"
                    iconBg="#EFF6FF"
                    iconEl={
                      <svg
                        fill="none"
                        height="22"
                        viewBox="0 0 24 24"
                        width="22"
                      >
                        <path
                          d="M12 2L2 7l10 5 10-5-10-5z"
                          stroke="#3B82F6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M2 17l10 5 10-5M2 12l10 5 10-5"
                          stroke="#3B82F6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    }
                    label="Backlog activo"
                    value={String(backlogActivo)}
                  />,
                  <OpKpiCard
                    badge="requieren ejecutivo"
                    badgeBg="#FFFBEB"
                    badgeColor="#D97706"
                    iconBg="#FFFBEB"
                    iconEl={
                      <svg
                        fill="none"
                        height="22"
                        viewBox="0 0 24 24"
                        width="22"
                      >
                        <path
                          d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"
                          stroke="#D97706"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                        <circle
                          cx="9"
                          cy="7"
                          r="4"
                          stroke="#D97706"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M18 8l4 4M22 8l-4 4"
                          stroke="#D97706"
                          strokeLinecap="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    }
                    label="Sin asignar"
                    value={String(stats.kpis.sinAsignar)}
                  />,
                  <OpKpiCard
                    badge={`${stats.kpis.rechazadas} de ${creadas} solicitudes`}
                    badgeBg="#FEF2F2"
                    badgeColor="#DC2626"
                    iconBg="#FEF2F2"
                    iconEl={
                      <svg
                        fill="none"
                        height="22"
                        viewBox="0 0 24 24"
                        width="22"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="#DC2626"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M15 9l-6 6M9 9l6 6"
                          stroke="#DC2626"
                          strokeLinecap="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    }
                    label="Tasa de rechazo"
                    value={fmtPct(stats.kpis.rechazadas, creadas)}
                    valueColor="#DC2626"
                  />,
                  <OpKpiCard
                    badge={`${stats.kpis.desestimadas} de ${creadas} solicitudes`}
                    badgeBg="#FFF7ED"
                    badgeColor="#EA580C"
                    iconBg="#FFF7ED"
                    iconEl={
                      <svg
                        fill="none"
                        height="22"
                        viewBox="0 0 24 24"
                        width="22"
                      >
                        <path
                          d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                          stroke="#EA580C"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M12 9v4M12 17h.01"
                          stroke="#EA580C"
                          strokeLinecap="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    }
                    label="Tasa desestimación"
                    value={fmtPct(stats.kpis.desestimadas, creadas)}
                    valueColor="#EA580C"
                  />,
                ].map((card, i) => (
                  <div
                    key={i}
                    style={
                      reducedMotion
                        ? { display: "flex" }
                        : {
                            animation: "fadeUp 0.2s ease-out both",
                            animationDelay: `${i * 50}ms`,
                            display: "flex",
                          }
                    }
                  >
                    {card}
                  </div>
                ))}
          </div>

          {/* Backlog por área (donut) + Resultados negativos */}
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "1fr 1fr 280px",
              ...fadeAt(160),
            }}
          >
            {/* Backlog por Owner / Área — donut */}
            <Card>
              <CardTitle sub="distribución del backlog activo">
                Backlog por Owner / Área
              </CardTitle>
              {!stats ? (
                <div
                  style={{ color: "#9CA3AF", fontSize: 12, padding: "8px 0" }}
                >
                  Cargando…
                </div>
              ) : stats.backlogPorArea.length === 0 ? (
                <ChartEmptyState
                  description="Cuando haya solicitudes pendientes vas a ver la distribución acá."
                  height={180}
                  message="Sin backlog activo"
                />
              ) : (
                <>
                  <ResponsiveContainer height={180} width="100%">
                    <PieChart>
                      <Pie
                        cx="50%"
                        cy="50%"
                        data={stats.backlogPorArea.map((a) => ({
                          name: a.area,
                          value: a.count,
                        }))}
                        dataKey="value"
                        innerRadius={52}
                        isAnimationActive={false}
                        nameKey="name"
                        outerRadius={84}
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
                                  fontSize={13}
                                  fontWeight={700}
                                  textAnchor="middle"
                                  x={cx}
                                  y={cy - 7}
                                >
                                  {backlogActivo}
                                </text>
                                <text
                                  dominantBaseline="middle"
                                  fill="#9CA3AF"
                                  fontSize={10}
                                  textAnchor="middle"
                                  x={cx}
                                  y={cy + 9}
                                >
                                  Activas
                                </text>
                              </g>
                            );
                          }}
                        />
                        {stats.backlogPorArea.map((_, i) => (
                          <Cell key={i} fill={AREA_COLORS[i] ?? "#9CA3AF"} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const raw = payload[0]?.value;
                          const val = typeof raw === "number" ? raw : 0;
                          const name = payload[0]?.name ?? "";
                          return (
                            <div
                              style={{
                                background: "#FFFFFF",
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
                                  marginBottom: 5,
                                }}
                              >
                                {String(name)}
                              </div>
                              <div
                                style={{
                                  color: "#111827",
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
                                  marginTop: 3,
                                }}
                              >
                                {backlogActivo > 0
                                  ? `${((val / backlogActivo) * 100).toFixed(1).replace(".", ",")}% del total`
                                  : ""}
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginTop: 12,
                    }}
                  >
                    {stats.backlogPorArea.map((item, i) => (
                      <div
                        key={item.area}
                        style={{
                          alignItems: "center",
                          display: "flex",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            background: AREA_COLORS[i] ?? "#9CA3AF",
                            borderRadius: 3,
                            flexShrink: 0,
                            height: 8,
                            width: 8,
                          }}
                        />
                        <span
                          style={{ color: "#374151", flex: 1, fontSize: 11 }}
                        >
                          {item.area}
                        </span>
                        <span style={{ color: "#9CA3AF", fontSize: 11 }}>
                          {backlogActivo > 0
                            ? `${Math.round((item.count / backlogActivo) * 100)}%`
                            : "0%"}
                        </span>
                        <span
                          style={{
                            color: "#111827",
                            fontSize: 11,
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                            minWidth: 24,
                            textAlign: "right",
                          }}
                        >
                          {item.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {/* Distribución del período — donut */}
            <Card>
              <CardTitle sub="distribución de solicitudes del período">
                Período seleccionado
              </CardTitle>
              {!stats ? (
                <div
                  style={{ color: "#9CA3AF", fontSize: 12, padding: "8px 0" }}
                >
                  Cargando…
                </div>
              ) : (
                (() => {
                  const liquidadas = stats.funnelPeriodo.liquidadas;
                  const rechazadas = stats.kpis.rechazadas;
                  const desestimadas = stats.kpis.desestimadas;
                  const enCurso = Math.max(
                    0,
                    creadas - liquidadas - rechazadas - desestimadas,
                  );
                  const periodoSlices = [
                    { name: "Liquidadas", value: liquidadas, color: "#10B981" },
                    { name: "En curso", value: enCurso, color: "#9CA3AF" },
                    { name: "Rechazadas", value: rechazadas, color: "#DC2626" },
                    {
                      name: "Desestimadas",
                      value: desestimadas,
                      color: "#EA580C",
                    },
                  ].filter((s) => s.value > 0);

                  if (periodoSlices.length === 0) {
                    return (
                      <ChartEmptyState
                        description="Cuando haya solicitudes pendientes vas a ver la distribución acá."
                        height={180}
                        message="Sin solicitudes en el período"
                      />
                    );
                  }

                  return (
                    <>
                      <ResponsiveContainer height={180} width="100%">
                        <PieChart>
                          <Pie
                            cx="50%"
                            cy="50%"
                            data={periodoSlices}
                            dataKey="value"
                            innerRadius={52}
                            isAnimationActive={false}
                            nameKey="name"
                            outerRadius={84}
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
                                      fontSize={13}
                                      fontWeight={700}
                                      textAnchor="middle"
                                      x={cx}
                                      y={cy - 7}
                                    >
                                      {creadas}
                                    </text>
                                    <text
                                      dominantBaseline="middle"
                                      fill="#9CA3AF"
                                      fontSize={10}
                                      textAnchor="middle"
                                      x={cx}
                                      y={cy + 9}
                                    >
                                      Creadas
                                    </text>
                                  </g>
                                );
                              }}
                            />
                            {periodoSlices.map((s, i) => (
                              <Cell key={i} fill={s.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const raw = payload[0]?.value;
                              const val = typeof raw === "number" ? raw : 0;
                              const name = payload[0]?.name ?? "";
                              const color =
                                (payload[0]?.payload as { color?: string })
                                  ?.color ?? "#374151";
                              return (
                                <div
                                  style={{
                                    background: "#FFFFFF",
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
                                      marginBottom: 5,
                                    }}
                                  >
                                    {String(name)}
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
                                      marginTop: 3,
                                    }}
                                  >
                                    {creadas > 0
                                      ? `${((val / creadas) * 100).toFixed(1).replace(".", ",")}% del total`
                                      : ""}
                                  </div>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          marginTop: 12,
                        }}
                      >
                        {periodoSlices.map((s) => (
                          <div
                            key={s.name}
                            style={{
                              alignItems: "center",
                              display: "flex",
                              gap: 8,
                            }}
                          >
                            <span
                              style={{
                                background: s.color,
                                borderRadius: 3,
                                flexShrink: 0,
                                height: 8,
                                width: 8,
                              }}
                            />
                            <span
                              style={{
                                color: "#374151",
                                flex: 1,
                                fontSize: 11,
                              }}
                            >
                              {s.name}
                            </span>
                            <span style={{ color: "#9CA3AF", fontSize: 11 }}>
                              {creadas > 0
                                ? `${Math.round((s.value / creadas) * 100)}%`
                                : "0%"}
                            </span>
                            <span
                              style={{
                                color: "#111827",
                                fontSize: 11,
                                fontVariantNumeric: "tabular-nums",
                                fontWeight: 600,
                                minWidth: 24,
                                textAlign: "right",
                              }}
                            >
                              {s.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()
              )}
            </Card>

            {/* Resultados negativos del período */}
            <Card style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    color: "#111827",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "-0.1px",
                  }}
                >
                  Resultados negativos
                </div>
                <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2 }}>
                  del período seleccionado
                </div>
              </div>

              {[
                {
                  label: "Rechazadas",
                  estadoCode: "Rechazada",
                  count: stats?.kpis.rechazadas,
                  color: "#DC2626",
                  bg: "#FEF2F2",
                  border: "#FECACA",
                },
                {
                  label: "Desestimadas",
                  estadoCode: "Desestimada",
                  count: stats?.kpis.desestimadas,
                  color: "#EA580C",
                  bg: "#FFF7ED",
                  border: "#FED7AA",
                },
                {
                  label: "Vencidas",
                  estadoCode: "Vencida",
                  count: stats?.kpis.vencidas,
                  color: "#6B7280",
                  bg: "#F9FAFB",
                  border: "#E5E7EB",
                },
              ].map(({ label, estadoCode, count, color, bg, border }, i) => (
                <div
                  key={label}
                  style={{
                    alignItems: "center",
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: i < 2 ? 8 : 0,
                    padding: "10px 14px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        color,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.2px",
                        textTransform: "uppercase",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{ color: "#9CA3AF", fontSize: 10, marginTop: 2 }}
                    >
                      {creadas > 0 && count != null
                        ? `${((count / creadas) * 100).toFixed(1).replace(".", ",")}% del período`
                        : "del período"}
                    </div>
                  </div>
                  <div
                    style={{ alignItems: "center", display: "flex", gap: 10 }}
                  >
                    <div
                      style={{
                        color,
                        fontSize: 26,
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 800,
                        lineHeight: 1,
                      }}
                    >
                      {count ?? "—"}
                    </div>
                    <a
                      href={`/solicitudes/core/historicas?estado=${encodeURIComponent(estadoCode)}`}
                      style={{
                        color,
                        fontSize: 12,
                        fontWeight: 600,
                        opacity: 0.7,
                        textDecoration: "none",
                        transition: "opacity 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.opacity = "1")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.opacity = "0.7")
                      }
                    >
                      Ver →
                    </a>
                  </div>
                </div>
              ))}

              {stats && (
                <div
                  style={{
                    color: "#9CA3AF",
                    fontSize: 11,
                    marginTop: "auto",
                    paddingTop: 12,
                    textAlign: "right",
                  }}
                >
                  {totalNegativos} en total · {fmtPct(totalNegativos, creadas)}{" "}
                  del período
                </div>
              )}
            </Card>
          </div>

          {/* Sin asignar — lista */}
          <div style={{ marginTop: 12, ...fadeAt(210) }}>
            <Card>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      color: "#111827",
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: "-0.1px",
                    }}
                  >
                    Sin asignar
                  </div>
                  <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2 }}>
                    solicitudes que requieren ejecutivo
                  </div>
                </div>
                <span
                  style={{
                    background: "#FFF7ED",
                    border: "1px solid #FED7AA",
                    borderRadius: 12,
                    color: "#D97706",
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 700,
                    padding: "2px 10px",
                  }}
                >
                  {stats?.kpis.sinAsignar ?? (stats ? 0 : "—")}
                </span>
              </div>

              {/* Table header */}
              <div
                style={{
                  borderBottom: "1px solid #F3F4F6",
                  color: "#9CA3AF",
                  display: "grid",
                  fontSize: 10,
                  fontWeight: 600,
                  gridTemplateColumns: "1fr 180px 130px 72px 52px",
                  letterSpacing: "0.4px",
                  paddingBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                <span>Titular</span>
                <span>Línea</span>
                <span>Estado</span>
                <span style={{ textAlign: "right" }}>Días activa</span>
                <span />
              </div>

              {/* Rows */}
              {(stats?.solicitudesSinAsignar ?? []).map((item, i, arr) => (
                <div
                  key={item.id}
                  style={{
                    alignItems: "center",
                    borderBottom:
                      i < arr.length - 1 ? "1px solid #F9FAFB" : "none",
                    display: "grid",
                    gridTemplateColumns: "1fr 180px 130px 72px 52px",
                    padding: "9px 0",
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: "#111827",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {item.titular}
                    </div>
                    <div
                      style={{ color: "#9CA3AF", fontSize: 11, marginTop: 1 }}
                    >
                      {item.id}
                    </div>
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      fontSize: 11,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.linea}
                  </div>
                  <div>
                    <EstadoBadge estado={item.estado} />
                  </div>
                  <div
                    style={{
                      color:
                        item.diasActiva >= 5
                          ? "#DC2626"
                          : item.diasActiva >= 3
                            ? "#D97706"
                            : "#374151",
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      textAlign: "right",
                    }}
                  >
                    {item.diasActiva}d
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <a
                      href={generatePath("/solicitudes/core/detalle/:id", {
                        id: item.id,
                      })}
                      style={{
                        color: BRAND,
                        fontSize: 12,
                        fontWeight: 600,
                        textDecoration: "none",
                        transition: "opacity 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.opacity = "0.7")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.opacity = "1")
                      }
                    >
                      Ver →
                    </a>
                  </div>
                </div>
              ))}

              {stats && (stats.solicitudesSinAsignar ?? []).length === 0 && (
                <div
                  style={{
                    color: "#9CA3AF",
                    fontSize: 12,
                    padding: "12px 0",
                    textAlign: "center",
                  }}
                >
                  No hay solicitudes sin asignar
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ── Vista: Rendimiento ───────────────────────────────────────────────── */}
      {activeTab === "rendimiento" && (
        <PerformanceDashboardView data={PERFORMANCE_MOCK} />
      )}
    </div>
  );
}
