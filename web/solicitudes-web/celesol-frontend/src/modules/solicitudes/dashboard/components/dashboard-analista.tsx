import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  BarRow,
  DashboardFilterSelect,
  EstadoBadge,
  FilterBar,
  TBODY_ROW,
  TD,
  TH,
} from "@/modules/dashboard/admin/components/admin-dashboard-shared";

import { useDashboardAnalistaStatsQuery } from "../hooks/use-dashboard-analista-stats-query";
import {
  DEFAULT_ANALISTA_DASHBOARD_FILTERS,
  type AnalistaDashboardFilters,
} from "../types";

const BACKLOG_COLORS = ["#3B82F6", "#059669", "#9CA3AF"];

function buildPeriodoOptions(monthsBack = 6) {
  const now = new Date();
  const labels = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const options: Array<{ label: string; value: string }> = [];
  for (let i = 0; i < monthsBack; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({
      label: `${labels[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`,
      value: ym,
    });
  }
  return options;
}
const PERIODO_OPTIONS = buildPeriodoOptions();

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
  periodo: string;
  umbralDias: string;
  vendedorId: string;
  vista: "mis_casos" | "sin_asignar" | "ambos";
};

function draftToApiFilters(draft: DraftFilters): AnalistaDashboardFilters {
  const [year, month] = draft.periodo.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    conRetrabajo: draft.conRetrabajo,
    estado: draft.estado,
    linea: draft.linea,
    fechaDesde: `${draft.periodo}-01`,
    fechaHasta: `${draft.periodo}-${String(lastDay).padStart(2, "0")}`,
    umbralDias: Number(draft.umbralDias) || 7,
    vendedorId: draft.vendedorId,
    vista: draft.vista,
  };
}

const DEFAULT_DRAFT: DraftFilters = {
  conRetrabajo: "",
  estado: "",
  linea: "",
  periodo: PERIODO_OPTIONS[0]?.value ?? "",
  umbralDias: String(DEFAULT_ANALISTA_DASHBOARD_FILTERS.umbralDias),
  vendedorId: "",
  vista: "mis_casos",
};

function fmtPct(v: number | null) {
  return v == null ? "Sin datos" : `${Math.round(v * 100)}%`;
}

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

export function DashboardAnalista() {
  const [draft, setDraft] = useState<DraftFilters>(DEFAULT_DRAFT);
  const [appliedFilters, setAppliedFilters] =
    useState<AnalistaDashboardFilters>(DEFAULT_ANALISTA_DASHBOARD_FILTERS);
  const set = (key: keyof DraftFilters) => (v: string) =>
    setDraft((p) => ({ ...p, [key]: v }) as DraftFilters);

  const statsQuery = useDashboardAnalistaStatsQuery(appliedFilters);
  const stats = statsQuery.data;

  const handleApply = () => setAppliedFilters(draftToApiFilters(draft));
  const handleClear = () => {
    setDraft(DEFAULT_DRAFT);
    setAppliedFilters(DEFAULT_ANALISTA_DASHBOARD_FILTERS);
  };

  const backlogTotal = (stats?.backlogPorEstado ?? []).reduce(
    (s, b) => s + b.count,
    0,
  );
  const maxBacklog = Math.max(
    1,
    ...(stats?.backlogPorEstado ?? []).map((b) => b.count),
  );

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
          Carga de trabajo, backlog y retrabajo de tus casos.
        </p>
      </div>

      <FilterBar onApply={handleApply} onClear={handleClear}>
        <DashboardFilterSelect
          onChange={set("vista")}
          options={VISTA_OPTIONS}
          placeholder="Vista operativa"
          value={draft.vista}
        />
        <DashboardFilterSelect
          onChange={set("periodo")}
          options={PERIODO_OPTIONS}
          placeholder="Período"
          value={draft.periodo}
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
          gridTemplateColumns: "repeat(5, 1fr)",
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
        <AnalistaKpiCard
          badge="Confirmadas + Rechazadas"
          badgeBg="#FFF7ED"
          badgeColor="#EA580C"
          iconBg="#FFF7ED"
          iconEl={
            <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
              <path
                d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                stroke="#EA580C"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          }
          label="Tasa de rechazo del período"
          value={stats ? fmtPct(stats.kpis.tasaDeRechazoPeriodo) : "—"}
          valueColor="#EA580C"
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 12,
        }}
      >
        <Card>
          <CardTitle sub="distribución del universo activo según Vista operativa">
            Backlog por estado
          </CardTitle>
          {(stats?.backlogPorEstado ?? []).map(({ estado, count }, i, arr) => (
            <BarRow
              key={estado}
              animDelay={i * 60}
              color={BACKLOG_COLORS[i % BACKLOG_COLORS.length]}
              label={estado}
              labelW={140}
              mb={i < arr.length - 1 ? 9 : 0}
              pct={`${Math.round((count / maxBacklog) * 100)}%`}
              value={count}
              valueW={24}
            />
          ))}
          {stats && backlogTotal === 0 && (
            <div style={{ color: "#9CA3AF", fontSize: 12, padding: "8px 0" }}>
              Sin casos en el universo actual
            </div>
          )}
        </Card>

        <Card>
          <CardTitle sub="casos evaluados por vos en el período">
            Retrabajo y revisiones
          </CardTitle>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              {
                label: "Con retrabajo",
                value: stats?.retrabajoYRevisiones.conRetrabajo,
                color: "#D97706",
                bg: "#FFFBEB",
              },
              {
                label: "≥ 3 revisiones",
                value: stats?.retrabajoYRevisiones.tresOMasRevisiones,
                color: "#DC2626",
                bg: "#FEF2F2",
              },
              {
                label: "Revisiones / caso",
                value: stats
                  ? stats.retrabajoYRevisiones.promedioRevisionesPorCaso.toFixed(
                      1,
                    )
                  : undefined,
                color: "#3B82F6",
                bg: "#EFF6FF",
              },
            ].map(({ label, value, color, bg }) => (
              <div
                key={label}
                style={{
                  background: bg,
                  border: `1px solid ${color}33`,
                  borderRadius: 8,
                  flex: 1,
                  padding: "10px 12px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    color,
                    fontSize: 20,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {value ?? "—"}
                </div>
                <div style={{ color: "#9CA3AF", fontSize: 10, marginTop: 4 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

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

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <Card>
          <CardTitle sub="≥ 3 revisiones en el período">
            Casos con múltiples revisiones
          </CardTitle>
          <table
            style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
                <th style={TH}>Titular</th>
                <th style={TH}>Estado</th>
                <th style={{ ...TH, textAlign: "right" }}>Revisiones</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.casosConMultiplesRevisiones ?? []).map((c, i, arr) => (
                <tr key={c.id} style={i < arr.length - 1 ? TBODY_ROW : {}}>
                  <td style={TD}>{c.titular}</td>
                  <td style={TD}>
                    <EstadoBadge estado={c.estado} />
                  </td>
                  <td
                    style={{
                      ...TD,
                      color: "#DC2626",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      textAlign: "right",
                    }}
                  >
                    {c.cantidadRevisiones}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats && stats.casosConMultiplesRevisiones.length === 0 && (
            <div
              style={{
                color: "#9CA3AF",
                fontSize: 12,
                padding: "12px 0",
                textAlign: "center",
              }}
            >
              Sin casos con retrabajo elevado
            </div>
          )}
        </Card>

        <Card>
          <CardTitle sub={`> ${draft.umbralDias} días en la transición actual`}>
            Transiciones lentas
          </CardTitle>
          <table
            style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
                <th style={TH}>Titular</th>
                <th style={TH}>Transición</th>
                <th style={{ ...TH, textAlign: "right" }}>Tiempo</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.transicionesLentas ?? []).map((t, i, arr) => {
                const critico =
                  t.diasAcumulados >= Number(draft.umbralDias) * 2;
                return (
                  <tr key={t.id} style={i < arr.length - 1 ? TBODY_ROW : {}}>
                    <td style={TD}>{t.titular}</td>
                    <td style={{ ...TD, color: "#6B7280", fontSize: 11 }}>
                      {t.estadoActual} → {t.estadoDestinoEsperado}
                    </td>
                    <td
                      style={{
                        ...TD,
                        color: critico ? "#DC2626" : "#D97706",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {t.diasAcumulados}d
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stats && stats.transicionesLentas.length === 0 && (
            <div
              style={{
                color: "#9CA3AF",
                fontSize: 12,
                padding: "12px 0",
                textAlign: "center",
              }}
            >
              Sin transiciones lentas
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
