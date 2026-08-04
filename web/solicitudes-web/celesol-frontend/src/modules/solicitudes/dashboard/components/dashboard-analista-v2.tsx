import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { generatePath } from "react-router-dom";
import { Cell, Pie, PieChart, Tooltip } from "recharts";

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

import { useDashboardAnalistaV2StatsQuery } from "../hooks/use-dashboard-analista-v2-stats-query";
import {
  DEFAULT_ANALISTA_DASHBOARD_FILTERS,
  type AnalistaDashboardFilters,
} from "../types";

const ESTADO_DONUT_COLORS = [
  "#3B82F6",
  "#059669",
  "#D97706",
  "#7C3AED",
  "#9CA3AF",
];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const VISTA_OPTIONS = [
  { label: "Mis casos", value: "mis_casos" },
  { label: "Sin asignar en mi área", value: "sin_asignar" },
  { label: "Mis casos + sin asignar", value: "ambos" },
];
const RETRABAJO_OPTIONS = [
  { label: "Con retrabajo", value: "con" },
  { label: "Sin retrabajo", value: "sin" },
];
const UMBRAL_OPTIONS = [
  { label: "> 3 días", value: "3" },
  { label: "> 7 días", value: "7" },
  { label: "> 14 días", value: "14" },
];

type DraftFilters = {
  conRetrabajo: "" | "con" | "sin";
  estado: string;
  linea: string;
  fechaDesde: string;
  fechaHasta: string;
  umbralDias: string;
  vendedorId: string;
  vista: "mis_casos" | "sin_asignar" | "ambos";
};

function draftToApiFilters(draft: DraftFilters): AnalistaDashboardFilters {
  return {
    conRetrabajo: draft.conRetrabajo,
    estado: draft.estado,
    linea: draft.linea,
    fechaDesde: draft.fechaDesde,
    fechaHasta: draft.fechaHasta,
    umbralDias: Number(draft.umbralDias) || 7,
    vendedorId: draft.vendedorId,
    vista: draft.vista,
  };
}

const DEFAULT_DRAFT: DraftFilters = {
  conRetrabajo: "",
  estado: "",
  linea: "",
  fechaDesde: DEFAULT_ANALISTA_DASHBOARD_FILTERS.fechaDesde,
  fechaHasta: DEFAULT_ANALISTA_DASHBOARD_FILTERS.fechaHasta,
  umbralDias: String(DEFAULT_ANALISTA_DASHBOARD_FILTERS.umbralDias),
  vendedorId: "",
  vista: "mis_casos",
};

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
        padding: "20px 24px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children, sub }: { children: ReactNode; sub?: string }) {
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

function AnalistaKpiCard({
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
        padding: "20px",
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

function VerLink({ id }: { id: string }) {
  return (
    <a
      href={generatePath("/solicitudes/core/detalle/:id", { id })}
      style={{
        color: "#E87722",
        fontSize: 12,
        fontWeight: 600,
        textDecoration: "none",
        transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      Ver →
    </a>
  );
}

function DonutCard({
  data,
  sub,
  title,
  totalLabel,
}: {
  data: Array<{ color: string; name: string; value: number }>;
  sub: string;
  title: string;
  totalLabel: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card>
      <CardTitle sub={sub}>{title}</CardTitle>
      {total === 0 ? (
        <ChartEmptyState
          description="Cuando haya solicitudes pendientes vas a ver la distribución acá."
          height={160}
          message="Sin datos para mostrar"
        />
      ) : (
        <div style={{ alignItems: "center", display: "flex", gap: 24 }}>
          <div style={{ flexShrink: 0, position: "relative" }}>
            <PieChart height={160} width={160}>
              <Pie
                cx={80}
                cy={80}
                data={data}
                dataKey="value"
                innerRadius={46}
                isAnimationActive={false}
                nameKey="name"
                outerRadius={76}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((s, i) => (
                  <Cell key={i} fill={s.color} />
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
                    </div>
                  );
                }}
              />
            </PieChart>
            <div
              style={{
                left: "50%",
                pointerEvents: "none",
                position: "absolute",
                textAlign: "center",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }}
            >
              <div style={{ color: "#111827", fontSize: 15, fontWeight: 700 }}>
                {total}
              </div>
              <div style={{ color: "#9CA3AF", fontSize: 9 }}>{totalLabel}</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {data.map((s) => (
              <div
                key={s.name}
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: 8,
                  marginBottom: 9,
                }}
              >
                <span
                  style={{
                    background: s.color,
                    borderRadius: 2,
                    flexShrink: 0,
                    height: 8,
                    width: 8,
                  }}
                />
                <span style={{ color: "#4B5563", flex: 1, fontSize: 11 }}>
                  {s.name}
                </span>
                <span
                  style={{
                    color: "#111827",
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                  }}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function TurnoBadge({ turno }: { turno: "mia" | "otro" }) {
  const esMia = turno === "mia";
  return (
    <span
      style={{
        background: esMia ? "#ECFDF5" : "#F3F4F6",
        border: `1px solid ${esMia ? "#A7F3D0" : "#E5E7EB"}`,
        borderRadius: 4,
        color: esMia ? "#059669" : "#6B7280",
        display: "inline-block",
        fontSize: 10,
        fontWeight: 500,
        lineHeight: "16px",
        padding: "0 6px",
        whiteSpace: "nowrap",
      }}
    >
      {esMia ? "Esperando tu acción" : "Esperando a otro"}
    </span>
  );
}

export function DashboardAnalistaV2() {
  const [draft, setDraft] = useState<DraftFilters>(DEFAULT_DRAFT);
  const [appliedFilters, setAppliedFilters] =
    useState<AnalistaDashboardFilters>(DEFAULT_ANALISTA_DASHBOARD_FILTERS);
  const set = (key: keyof DraftFilters) => (v: string) =>
    setDraft((p) => ({ ...p, [key]: v }) as DraftFilters);

  const statsQuery = useDashboardAnalistaV2StatsQuery(appliedFilters);
  const stats = statsQuery.data;

  const handleApply = () => setAppliedFilters(draftToApiFilters(draft));
  const handleClear = () => {
    setDraft(DEFAULT_DRAFT);
    setAppliedFilters(DEFAULT_ANALISTA_DASHBOARD_FILTERS);
  };

  const misCasosActivos = stats?.misCasosActivos ?? [];
  const estadoCountMap = new Map<string, number>();
  for (const c of misCasosActivos) {
    estadoCountMap.set(c.estado, (estadoCountMap.get(c.estado) ?? 0) + 1);
  }
  const estadoChartData = Array.from(estadoCountMap.entries()).map(
    ([name, value], i) => ({
      color: ESTADO_DONUT_COLORS[i % ESTADO_DONUT_COLORS.length],
      name,
      value,
    }),
  );

  const turnoCountMap = new Map<"mia" | "otro", number>();
  for (const c of misCasosActivos) {
    turnoCountMap.set(c.turno, (turnoCountMap.get(c.turno) ?? 0) + 1);
  }
  const turnoChartData = [
    {
      color: "#059669",
      name: "Esperando tu acción",
      value: turnoCountMap.get("mia") ?? 0,
    },
    {
      color: "#9CA3AF",
      name: "Esperando a otro",
      value: turnoCountMap.get("otro") ?? 0,
    },
  ].filter((d) => d.value > 0);

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
          Solicitudes · Riesgo
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
          Mi Bandeja — Análisis y Riesgo
        </h1>
        <p style={{ color: "#6B7280", fontSize: 12, margin: 0 }}>
          Tu cola de trabajo: casos activos, casos para tomar y tu actividad
          reciente.
        </p>
      </div>

      <FilterBar onApply={handleApply} onClear={handleClear}>
        <DashboardFilterSelect
          onChange={set("vista")}
          options={VISTA_OPTIONS}
          placeholder="Vista operativa"
          value={draft.vista}
        />
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
        <DashboardFilterSelect
          emptyOptionLabel="Todos"
          onChange={set("estado")}
          options={(stats?.filterOptions.estados ?? []).map((e) => ({
            label: e.name,
            value: e.code,
          }))}
          placeholder="Estado"
          value={draft.estado}
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
        <DashboardFilterSelect
          emptyOptionLabel="Todos"
          onChange={set("conRetrabajo")}
          options={RETRABAJO_OPTIONS}
          placeholder="Con retrabajo"
          value={draft.conRetrabajo}
        />
        <DashboardFilterSelect
          onChange={set("umbralDias")}
          options={UMBRAL_OPTIONS}
          placeholder="Umbral antigüedad"
          value={draft.umbralDias}
        />
      </FilterBar>

      {statsQuery.isError && (
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
          No se pudieron cargar tus estadísticas. Probá actualizar la página.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(4, 1fr)",
          marginBottom: 12,
        }}
      >
        <AnalistaKpiCard
          badge="activas ahora"
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
            </svg>
          }
          label="Asignados a mí"
          value={stats ? String(stats.kpis.asignadosAMi) : "—"}
        />
        <AnalistaKpiCard
          badge="disponibles en mi área"
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
                d="M12 8v4l3 2"
                stroke="#D97706"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          }
          label="Sin asignar en mi área"
          value={stats ? String(stats.kpis.sinAsignarEnMiArea) : "—"}
        />
        <AnalistaKpiCard
          badge={`> ${draft.umbralDias} días`}
          badgeBg="#FEF2F2"
          badgeColor="#DC2626"
          iconBg="#FEF2F2"
          iconEl={
            <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="#DC2626"
                strokeWidth="1.8"
              />
              <path
                d="M12 7v5l3 3"
                stroke="#DC2626"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          }
          label="Detenidos"
          value={stats ? String(stats.kpis.detenidosMasDeNDias) : "—"}
          valueColor="#DC2626"
        />
        <AnalistaKpiCard
          badge="esperando corrección"
          badgeBg="#F5F3FF"
          badgeColor="#7C3AED"
          iconBg="#F5F3FF"
          iconEl={
            <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
              <path
                d="M3 12a9 9 0 1 0 9-9"
                stroke="#7C3AED"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
          }
          label="Casos con revisión"
          value={stats ? String(stats.kpis.casosConRevision) : "—"}
        />
      </div>

      {misCasosActivos.length > 0 && (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr 1fr",
            marginBottom: 12,
          }}
        >
          <DonutCard
            data={estadoChartData}
            sub="distribución de tus casos activos"
            title="Mis casos activos por estado"
            totalLabel="Casos"
          />
          <DonutCard
            data={turnoChartData}
            sub="qué proporción depende de vos ahora mismo"
            title="Mis casos activos por turno"
            totalLabel="Casos"
          />
        </div>
      )}

      <Card style={{ marginBottom: 12 }}>
        <CardTitle sub="todo lo que tenés asignado, priorizado">
          Mis casos activos
        </CardTitle>
        <table
          style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
              <th style={TH}>Titular</th>
              <th style={TH}>Línea</th>
              <th style={TH}>Estado</th>
              <th style={TH}>Turno</th>
              <th style={{ ...TH, textAlign: "right" }}>Antigüedad</th>
              <th style={{ ...TH, textAlign: "right" }}>Revisiones</th>
              <th style={{ ...TH, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {(stats?.misCasosActivos ?? []).map((c, i, arr) => {
              const urgente = c.diasAcumulados >= Number(draft.umbralDias);
              return (
                <tr
                  key={c.id}
                  style={{
                    ...(i < arr.length - 1 ? TBODY_ROW : {}),
                    background: c.volvioCorregido
                      ? "#ECFDF5"
                      : urgente
                        ? "#FFFBEB"
                        : undefined,
                  }}
                >
                  <td style={TD}>
                    {c.titular}
                    {c.volvioCorregido && (
                      <span
                        style={{
                          background: "#059669",
                          borderRadius: 4,
                          color: "#FFFFFF",
                          fontSize: 9,
                          fontWeight: 600,
                          marginLeft: 6,
                          padding: "1px 5px",
                        }}
                      >
                        VOLVIÓ CORREGIDO
                      </span>
                    )}
                  </td>
                  <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                    {c.linea}
                  </td>
                  <td style={TD}>
                    <EstadoBadge estado={c.estado} />
                  </td>
                  <td style={TD}>
                    <TurnoBadge turno={c.turno} />
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
                    {c.diasAcumulados}d
                  </td>
                  <td
                    style={{
                      ...TD,
                      color: c.cantidadRevisiones >= 3 ? "#DC2626" : "#9CA3AF",
                      fontSize: 11,
                      fontWeight: c.cantidadRevisiones >= 3 ? 700 : undefined,
                      textAlign: "right",
                    }}
                  >
                    {c.cantidadRevisiones}
                  </td>
                  <td style={{ ...TD, textAlign: "right" }}>
                    <VerLink id={c.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {stats && stats.misCasosActivos.length === 0 && (
          <div
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              padding: "12px 0",
              textAlign: "center",
            }}
          >
            No tenés casos activos asignados
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <CardTitle sub="solicitudes sin asignar en tu área, ordenadas por tiempo en cola">
          Casos para tomar
        </CardTitle>
        <table
          style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
              <th style={TH}>Titular</th>
              <th style={TH}>Línea</th>
              <th style={TH}>Vendedor</th>
              <th style={{ ...TH, textAlign: "right" }}>Tiempo en cola</th>
              <th style={{ ...TH, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {(stats?.casosParaTomar ?? []).map((c, i, arr) => {
              const urgente = c.diasEnCola >= Number(draft.umbralDias);
              return (
                <tr
                  key={c.id}
                  style={{
                    ...(i < arr.length - 1 ? TBODY_ROW : {}),
                    background: urgente ? "#FFFBEB" : undefined,
                  }}
                >
                  <td style={TD}>{c.titular}</td>
                  <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                    {c.linea}
                  </td>
                  <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                    {c.vendedor}
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
                    {c.diasEnCola} {c.diasEnCola === 1 ? "día" : "días"}
                  </td>
                  <td style={{ ...TD, textAlign: "right" }}>
                    <VerLink id={c.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {stats && stats.casosParaTomar.length === 0 && (
          <div
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              padding: "12px 0",
              textAlign: "center",
            }}
          >
            No hay casos sin asignar en tu área
          </div>
        )}
      </Card>

      <Card>
        <CardTitle sub="tus últimas 15 acciones">
          Historial de trabajo
        </CardTitle>
        <table
          style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
              <th style={TH}>Fecha</th>
              <th style={TH}>Solicitud</th>
              <th style={TH}>Acción</th>
              <th style={TH}>Resultado</th>
              <th style={{ ...TH, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {(stats?.historialTrabajo ?? []).map((h, i, arr) => (
              <tr
                key={`${h.fecha}-${i}`}
                style={i < arr.length - 1 ? TBODY_ROW : {}}
              >
                <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                  {new Date(h.fecha).toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td style={TD}>{h.titular}</td>
                <td style={{ ...TD, color: "#374151", fontSize: 11 }}>
                  {h.accion}
                </td>
                <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                  {h.resultado}
                </td>
                <td style={{ ...TD, textAlign: "right" }}>
                  <VerLink id={h.solicitudId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats && stats.historialTrabajo.length === 0 && (
          <div
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              padding: "12px 0",
              textAlign: "center",
            }}
          >
            Sin actividad reciente
          </div>
        )}
      </Card>
    </div>
  );
}
