import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardFilterSelect } from "./admin-dashboard-shared";
import type { PerformanceData } from "../mocks/performance-dashboard.mock";

// ── Color tokens ──────────────────────────────────────────────────────────────
const BRAND = "#E87722";
const LINEA_COLORS = ["#3B82F6", BRAND, "#10B981"];

// ── Scroll-triggered fade-in ──────────────────────────────────────────────────
function useInView() {
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const [visible, setVisible] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) return;
    const el = ref.current;
    if (!el) return;

    const check = () => {
      if (doneRef.current) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight - 40 && rect.bottom > 0) {
        doneRef.current = true;
        setVisible(true);
      }
    };

    const targets: (Element | Window)[] = [window];
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const s = window.getComputedStyle(node);
      if (/auto|scroll/.test(s.overflow + s.overflowY)) targets.push(node);
      node = node.parentElement;
    }

    check();
    targets.forEach((t) =>
      t.addEventListener("scroll", check, { passive: true }),
    );
    return () => targets.forEach((t) => t.removeEventListener("scroll", check));
  }, [reducedMotion]);

  return { ref, visible };
}

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
}) {
  const { ref, visible } = useInView();
  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(18px)",
        transition: `opacity 0.35s ease-out ${delay}ms, transform 0.35s ease-out ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function pct(count: number, max: number): string {
  if (max === 0) return "0%";
  return `${Math.round((count / max) * 100)}%`;
}

function fmtMoney(n: number): string {
  return (
    "$" +
    Math.round(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  );
}

function fmtMillions(n: number): string {
  const m = n / 1_000_000;
  const str = m % 1 === 0 ? m.toFixed(0) : m.toFixed(1);
  return `$${str}M`;
}

// ── Layout primitives ─────────────────────────────────────────────────────────
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
  children,
  sub,
}: {
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
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

// ── KPI card with trend indicator ─────────────────────────────────────────────
function PerfKpiCard({
  badge,
  badgeBg,
  badgeColor,
  iconBg,
  iconEl,
  label,
  trend,
  value,
}: {
  badge: string;
  badgeBg: string;
  badgeColor: string;
  iconBg: string;
  iconEl: ReactNode;
  label: string;
  trend?: number;
  value: string;
}) {
  const isUp = (trend ?? 0) >= 0;
  const trendColor = isUp ? "#059669" : "#DC2626";
  const trendBg = isUp ? "#ECFDF5" : "#FEF2F2";
  return (
    <div
      style={{
        alignItems: "center",
        background: "#FFFFFF",
        border: "1px solid #E8EAED",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        display: "flex",
        gap: 14,
        padding: "18px 20px",
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
          width: 44,
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
            letterSpacing: "0.5px",
            marginBottom: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: "#111827",
            fontSize: 22,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
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
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 5,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              background: badgeBg,
              borderRadius: 5,
              color: badgeColor,
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 500,
              overflow: "hidden",
              padding: "2px 8px",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {badge}
          </span>
          {trend != null && (
            <>
              <span
                style={{
                  alignItems: "center",
                  background: trendBg,
                  borderRadius: 5,
                  color: trendColor,
                  display: "inline-flex",
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 600,
                  gap: 2,
                  padding: "2px 6px",
                }}
              >
                {isUp ? "↑" : "↓"}{" "}
                {Math.abs(trend).toFixed(1).replace(".", ",")}%
              </span>
              <span style={{ color: "#C4C9D4", flexShrink: 0, fontSize: 10 }}>
                vs ant.
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rank row for vendedor rankings ────────────────────────────────────────────
function PerfRankRow({
  color,
  isLast,
  nombre,
  rank,
  value,
  width,
}: {
  color: string;
  isLast: boolean;
  nombre: string;
  rank: number;
  value: string;
  width: string;
}) {
  const [bg, text] =
    rank === 1
      ? ["#FEF3C7", "#92400E"]
      : rank === 2
        ? ["#F1F5F9", "#475569"]
        : ["#F3F4F6", "#6B7280"];
  return (
    <div
      style={{
        alignItems: "center",
        borderBottom: isLast ? undefined : "1px solid #F9FAFB",
        display: "flex",
        gap: 10,
        marginBottom: isLast ? 0 : 2,
        paddingBottom: isLast ? 0 : 10,
        paddingTop: rank === 1 ? 0 : 8,
      }}
    >
      <span
        style={{
          alignItems: "center",
          background: bg,
          borderRadius: 6,
          color: text,
          display: "flex",
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 700,
          height: 22,
          justifyContent: "center",
          width: 22,
        }}
      >
        {rank}
      </span>
      <span
        style={{
          color: "#374151",
          flex: 1,
          fontSize: 12,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {nombre}
      </span>
      <div
        style={{
          background: "#F1F3F6",
          borderRadius: 6,
          flexShrink: 0,
          height: 14,
          overflow: "hidden",
          width: 72,
        }}
      >
        <div
          style={{
            background: color,
            borderRadius: "0 6px 6px 0",
            height: "100%",
            width,
          }}
        />
      </div>
      <span
        style={{
          color: "#111827",
          flexShrink: 0,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          textAlign: "right",
          width: 88,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Historical area chart — main chart, more visual weight ────────────────────
function PerfHistoricalChart({
  historico,
  lineas,
  onSelectLinea,
  selectedLinea,
}: {
  historico: PerformanceData["historico"];
  lineas: string[];
  onSelectLinea: (linea: string) => void;
  selectedLinea: string;
}) {
  const lineaIndex = lineas.indexOf(selectedLinea);
  const color = LINEA_COLORS[lineaIndex] ?? BRAND;
  const chartData = historico[selectedLinea] ?? [];
  const gradId = `perf-grad-${lineaIndex}`;

  return (
    <Card style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ color: "#111827", fontSize: 14, fontWeight: 700 }}>
            Monto total invertido en préstamos por línea de crédito
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
            evolución mensual del monto generado
          </div>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
          <span
            style={{
              background: color,
              borderRadius: "50%",
              flexShrink: 0,
              height: 8,
              width: 8,
            }}
          />
          <DashboardFilterSelect
            onChange={onSelectLinea}
            options={lineas.map((l) => ({ label: l, value: l }))}
            value={selectedLinea}
          />
        </div>
      </div>

      <ResponsiveContainer height={260} width="100%">
        <AreaChart
          data={chartData}
          margin={{ bottom: 0, left: 0, right: 8, top: 4 }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
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
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            tickLine={false}
          />

          <YAxis
            axisLine={false}
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            tickFormatter={(v: number) => fmtMillions(v)}
            tickLine={false}
            width={56}
          />

          <Tooltip
            cursor={{ stroke: color, strokeDasharray: "4 2", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const raw = payload[0]?.value;
              const val = typeof raw === "number" ? raw : 0;
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
                    style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 4 }}
                  >
                    {String(label ?? "")}
                  </div>
                  <div
                    style={{
                      color: "#111827",
                      fontSize: 14,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      letterSpacing: "-0.3px",
                    }}
                  >
                    {fmtMoney(val)}
                  </div>
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: 5,
                      marginTop: 4,
                    }}
                  >
                    <span
                      style={{
                        background: color,
                        borderRadius: "50%",
                        display: "inline-block",
                        height: 6,
                        width: 6,
                      }}
                    />
                    <span style={{ color: "#6B7280", fontSize: 11 }}>
                      {selectedLinea}
                    </span>
                  </div>
                </div>
              );
            }}
          />

          <Area
            activeDot={{ fill: color, r: 5, stroke: "#FFFFFF", strokeWidth: 2 }}
            dataKey="monto"
            dot={false}
            fill={`url(#${gradId})`}
            stroke={color}
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── Unified vendedor ranking card with segmented tab selector ─────────────────
function PerfRankingVendedoresCard({
  maxCantidad,
  maxMonto,
  rankingCantidad,
  rankingMonto,
}: {
  maxCantidad: number;
  maxMonto: number;
  rankingCantidad: PerformanceData["rankingCantidad"];
  rankingMonto: PerformanceData["rankingMonto"];
}) {
  const [tab, setTab] = useState<"monto" | "cantidad">("monto");

  return (
    <Card>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>
            Ranking vendedores
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
            {tab === "monto"
              ? "por monto acumulado en el período"
              : "por cantidad de ventas en el período"}
          </div>
        </div>

        <div
          style={{
            background: "#F3F4F6",
            borderRadius: 8,
            display: "flex",
            gap: 2,
            padding: 3,
          }}
        >
          {(["monto", "cantidad"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? "#FFFFFF" : "transparent",
                border: "none",
                borderRadius: 6,
                boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.10)" : undefined,
                color: tab === t ? "#111827" : "#6B7280",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: tab === t ? 600 : 400,
                padding: "5px 12px",
                transition: "all 0.15s",
              }}
              type="button"
            >
              {t === "monto" ? "Por monto" : "Por cantidad"}
            </button>
          ))}
        </div>
      </div>

      {tab === "monto"
        ? rankingMonto.map((item, i, arr) => (
            <PerfRankRow
              key={item.nombre}
              color={BRAND}
              isLast={i === arr.length - 1}
              nombre={item.nombre}
              rank={i + 1}
              value={fmtMoney(item.monto)}
              width={pct(item.monto, maxMonto)}
            />
          ))
        : rankingCantidad.map((item, i, arr) => (
            <PerfRankRow
              key={item.nombre}
              color="#3B82F6"
              isLast={i === arr.length - 1}
              nombre={item.nombre}
              rank={i + 1}
              value={`${item.cantidad} ventas`}
              width={pct(item.cantidad, maxCantidad)}
            />
          ))}
    </Card>
  );
}

// ── Insights card — vertical panel (replaces 3-card horizontal summary) ────────
function PerfInsightsCard({
  resumen,
}: {
  resumen: PerformanceData["resumen"];
}) {
  const items = [
    {
      iconBg: "#F3F4F6",
      iconEl: (
        <svg fill="none" height="18" viewBox="0 0 18 18" width="18">
          <rect fill="#9CA3AF" height="7" rx="1.5" width="4" x="1" y="10" />
          <rect fill="#9CA3AF" height="10" rx="1.5" width="4" x="7" y="7" />
          <rect fill="#9CA3AF" height="14" rx="1.5" width="4" x="13" y="3" />
        </svg>
      ),
      label: "Línea con mayor monto",
      secondary: fmtMoney(resumen.montoTopLinea),
      value: resumen.lineaTop,
    },
    {
      iconBg: "#FFF4EE",
      iconEl: (
        <svg fill="none" height="18" viewBox="0 0 18 18" width="18">
          <path
            d="M9 1l2 4.5 5 .5-3.6 3.4.9 5L9 12l-4.3 2.4.9-5L2 6l5-.5z"
            stroke={BRAND}
            strokeLinejoin="round"
            strokeWidth="1.4"
          />
        </svg>
      ),
      label: "Vendedor líder · monto",
      secondary: fmtMoney(resumen.montoTopVendedor),
      value: resumen.vendedorTopMonto,
    },
    {
      iconBg: "#EFF6FF",
      iconEl: (
        <svg fill="none" height="18" viewBox="0 0 18 18" width="18">
          <circle cx="9" cy="6" r="3.5" stroke="#3B82F6" strokeWidth="1.4" />
          <path
            d="M2 17c0-3.9 3.1-7 7-7s7 3.1 7 7"
            stroke="#3B82F6"
            strokeLinecap="round"
            strokeWidth="1.4"
          />
        </svg>
      ),
      label: "Vendedor líder · cantidad",
      secondary: `${resumen.cantidadTopVendedor} ventas`,
      value: resumen.vendedorTopCantidad,
    },
  ] as const;

  return (
    <Card>
      <div style={{ display: "flex" }}>
        {items.map((item, i) => (
          <div
            key={item.label}
            style={{
              alignItems: "flex-start",
              borderLeft: i > 0 ? "1px solid #F3F4F6" : undefined,
              display: "flex",
              flex: 1,
              gap: 12,
              paddingLeft: i > 0 ? 20 : 0,
              paddingRight: i < items.length - 1 ? 20 : 0,
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: item.iconBg,
                borderRadius: 8,
                display: "flex",
                flexShrink: 0,
                height: 36,
                justifyContent: "center",
                width: 36,
              }}
            >
              {item.iconEl}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: "#9CA3AF",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  color: "#111827",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.2px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.value}
              </div>
              <div
                style={{
                  color: "#6B7280",
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 2,
                }}
              >
                {item.secondary}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Mora severity palette (1-30 → +90, light → critical) ─────────────────────
const MORA_COLORS = ["#FCD34D", "#FB923C", "#F87171", "#DC2626"];

// ── Chart: Préstamos otorgados por período de tiempo seleccionado ─────────────
function PerfPrestamosOtorgadosChart({
  data,
}: {
  data: PerformanceData["prestamosOtorgados"];
}) {
  const [metric, setMetric] = useState<"cantidad" | "monto">("cantidad");
  const barColor = metric === "cantidad" ? "#3B82F6" : BRAND;

  return (
    <Card>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>
            Préstamos otorgados por período de tiempo seleccionado
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
            evolución de préstamos liquidados en el período
          </div>
        </div>
        <DashboardFilterSelect
          onChange={(v) => setMetric(v as "cantidad" | "monto")}
          options={[
            { label: "Cantidad", value: "cantidad" },
            { label: "Monto", value: "monto" },
          ]}
          value={metric}
        />
      </div>

      <ResponsiveContainer height={200} width="100%">
        <BarChart
          barSize={28}
          data={data}
          margin={{ bottom: 0, left: 0, right: 8, top: 4 }}
        >
          <CartesianGrid
            stroke="#F1F3F6"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            axisLine={false}
            dataKey="periodo"
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            tickFormatter={
              metric === "monto" ? (v: number) => fmtMillions(v) : undefined
            }
            tickLine={false}
            width={metric === "monto" ? 56 : 36}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const raw = payload[0]?.value;
              const val = typeof raw === "number" ? raw : 0;
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
                    style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 4 }}
                  >
                    {String(label ?? "")}
                  </div>
                  <div
                    style={{
                      color: "#111827",
                      fontSize: 14,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      letterSpacing: "-0.3px",
                    }}
                  >
                    {metric === "monto" ? fmtMoney(val) : `${val} préstamos`}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey={metric} fill={barColor} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── Chart: Mora por antigüedad ────────────────────────────────────────────────
function PerfMoraAntiguedadChart({
  data,
}: {
  data: PerformanceData["moraAntigüedad"];
}) {
  return (
    <Card>
      <CardTitle sub="monto en mora segmentado por días de atraso">
        Mora por antigüedad
      </CardTitle>

      <ResponsiveContainer height={200} width="100%">
        <BarChart
          barSize={52}
          data={data}
          margin={{ bottom: 0, left: 0, right: 8, top: 4 }}
        >
          <CartesianGrid
            stroke="#F1F3F6"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            axisLine={false}
            dataKey="bucket"
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            tickFormatter={(v: number) => fmtMillions(v)}
            tickLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const raw = payload[0]?.value;
              const val = typeof raw === "number" ? raw : 0;
              const item = data.find((d) => d.bucket === label);
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
                    style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 4 }}
                  >
                    {String(label ?? "")}
                  </div>
                  <div
                    style={{
                      color: "#111827",
                      fontSize: 14,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      letterSpacing: "-0.3px",
                    }}
                  >
                    {fmtMoney(val)}
                  </div>
                  {item != null && (
                    <div
                      style={{ color: "#6B7280", fontSize: 11, marginTop: 3 }}
                    >
                      {item.cantidad}{" "}
                      {item.cantidad === 1 ? "préstamo" : "préstamos"}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="monto" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={MORA_COLORS[i] ?? "#9CA3AF"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── Mora por línea de préstamo — static mock ──────────────────────────────────
const MORA_X_LINEA_MOCK = [
  { linea: "AMEJUCA ESPECIAL", monto: 1_800_000 },
  { linea: "NUEVOS CBU", monto: 1_100_000 },
  { linea: "PROPIA RECURRENTE CBU", monto: 600_000 },
];

function PerfMoraXLineaCard() {
  const total = MORA_X_LINEA_MOCK.reduce((s, l) => s + l.monto, 0);
  const pieData = MORA_X_LINEA_MOCK.map((item) => ({
    name: item.linea,
    value: item.monto,
  }));

  return (
    <Card>
      <CardTitle sub="distribución del saldo en mora por producto">
        Mora por línea de préstamo
      </CardTitle>

      <ResponsiveContainer height={180} width="100%">
        <PieChart>
          <Pie
            cx="50%"
            cy="50%"
            data={pieData}
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
                      fill="#DC2626"
                      fontSize={13}
                      fontWeight={700}
                      textAnchor="middle"
                      x={cx}
                      y={cy - 7}
                    >
                      {fmtMillions(total)}
                    </text>
                    <text
                      dominantBaseline="middle"
                      fill="#9CA3AF"
                      fontSize={10}
                      textAnchor="middle"
                      x={cx}
                      y={cy + 9}
                    >
                      En mora
                    </text>
                  </g>
                );
              }}
            />
            {pieData.map((_, i) => (
              <Cell key={i} fill={LINEA_COLORS[i] ?? "#9CA3AF"} />
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
                      maxWidth: 170,
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
                      letterSpacing: "-0.3px",
                    }}
                  >
                    {fmtMoney(val)}
                  </div>
                  <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
                    {total > 0
                      ? `${((val / total) * 100).toFixed(1).replace(".", ",")}% del total`
                      : ""}
                  </div>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Leyenda */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 16,
        }}
      >
        {MORA_X_LINEA_MOCK.map((item, i) => {
          const pct = total > 0 ? (item.monto / total) * 100 : 0;
          return (
            <div
              key={item.linea}
              style={{ alignItems: "center", display: "flex", gap: 10 }}
            >
              <div
                style={{
                  background: LINEA_COLORS[i] ?? "#9CA3AF",
                  borderRadius: "50%",
                  flexShrink: 0,
                  height: 8,
                  width: 8,
                }}
              />
              <span
                style={{
                  color: "#374151",
                  flex: 1,
                  fontSize: 12,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.linea}
              </span>
              <span
                style={{
                  color: "#6B7280",
                  flexShrink: 0,
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pct.toFixed(1).replace(".", ",")}%
              </span>
              <span
                style={{
                  color: "#111827",
                  flexShrink: 0,
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  minWidth: 80,
                  textAlign: "right",
                }}
              >
                {fmtMoney(item.monto)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #F3F4F6",
          display: "flex",
          justifyContent: "space-between",
          marginTop: 16,
          paddingTop: 12,
        }}
      >
        <span style={{ color: "#9CA3AF", fontSize: 11 }}>Total en mora</span>
        <span
          style={{
            color: "#DC2626",
            fontSize: 13,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
          }}
        >
          {fmtMoney(total)}
        </span>
      </div>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
// To connect real data later: change the call in admin-dashboard.tsx from
//   <PerformanceDashboardView data={PERFORMANCE_MOCK} />
// to
//   <PerformanceDashboardView data={realDataFromHook} />

// ── Proyección de cobranza — mock data ───────────────────────────────────────
const COBRANZA_PROYECCION_DATA = [
  { fecha: "01/06", esperado: 420_000, real: 455_000 },
  { fecha: "04/06", esperado: 510_000, real: 540_000 },
  { fecha: "07/06", esperado: 630_000, real: 690_000 },
  { fecha: "10/06", esperado: 720_000, real: 785_000 },
  { fecha: "13/06", esperado: 860_000, real: 910_000 },
  { fecha: "16/06", esperado: 760_000, real: 810_000 },
  { fecha: "19/06", esperado: 900_000, real: 970_000 },
  { fecha: "22/06", esperado: 1_020_000, real: 1_113_000 },
];

function CobranzaProyeccionCard() {
  return (
    <Card>
      {/* Header */}
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ color: "#111827", fontSize: 14, fontWeight: 700 }}>
            Proyección de cobranza
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 3 }}>
            Cobranza esperada según cuotas exigibles y vencimientos
          </div>
        </div>
        <span
          style={{
            background: "#F3F4F6",
            borderRadius: 6,
            color: "#6B7280",
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 10px",
            whiteSpace: "nowrap",
          }}
        >
          Corte 22/06/2026
        </span>
      </div>

      {/* Body: KPIs izquierda + gráfico derecha */}
      <div style={{ display: "flex", gap: 24 }}>
        {/* Columna izquierda: 2×2 mini cards + footer stats */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            gap: 12,
            width: 300,
          }}
        >
          <div
            style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}
          >
            {[
              { label: "Proy. 7 días", value: "$ 978.100" },
              { label: "Proy. 30 días", value: "$ 3.912.500" },
              { label: "Proy. 90 días", value: "$ 10.922.300" },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    color: "#3B82F6",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.5px",
                    marginBottom: 6,
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    color: "#1E40AF",
                    fontSize: 16,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 700,
                    letterSpacing: "-0.3px",
                    lineHeight: 1,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}

            {/* Cumplimiento al corte */}
            <div
              style={{
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  color: "#059669",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                Cumplimiento
              </div>
              <div
                style={{
                  color: "#065F46",
                  fontSize: 16,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  letterSpacing: "-0.3px",
                  lineHeight: 1,
                }}
              >
                84,00%
              </div>
            </div>
          </div>

          {/* Footer stats */}
          <div
            style={{
              borderTop: "1px solid #F3F4F6",
              display: "flex",
              flexWrap: "wrap",
              gap: 20,
              marginTop: 4,
              paddingTop: 12,
            }}
          >
            {[
              { label: "Cobrado real", value: "$ 1.113.000", color: "#059669" },
              {
                label: "Esperado al corte",
                value: "$ 1.020.000",
                color: "#374151",
              },
              { label: "Diferencia", value: "+9,1%", color: "#059669" },
            ].map(({ label, value, color }) => (
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
                    fontSize: 12,
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
        </div>

        {/* Columna derecha: gráfico */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
              <span style={{ color: "#111827", fontSize: 12, fontWeight: 600 }}>
                Proyectado vs Real
              </span>
              <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
                <div style={{ alignItems: "center", display: "flex", gap: 5 }}>
                  <svg height="8" width="20">
                    <line
                      stroke="#3B82F6"
                      strokeDasharray="4 3"
                      strokeWidth="2"
                      x1="0"
                      x2="20"
                      y1="4"
                      y2="4"
                    />
                  </svg>
                  <span style={{ color: "#6B7280", fontSize: 11 }}>
                    Esperado
                  </span>
                </div>
                <div style={{ alignItems: "center", display: "flex", gap: 5 }}>
                  <div
                    style={{
                      background: "#059669",
                      borderRadius: 1,
                      height: 2,
                      width: 20,
                    }}
                  />
                  <span style={{ color: "#6B7280", fontSize: 11 }}>Real</span>
                </div>
              </div>
            </div>
            <span
              style={{
                background: "#ECFDF5",
                borderRadius: 6,
                color: "#059669",
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 10px",
              }}
            >
              Real vs Esperado: +9,1%
            </span>
          </div>

          <ResponsiveContainer height={190} width="100%">
            <LineChart
              data={COBRANZA_PROYECCION_DATA}
              margin={{ bottom: 0, left: 0, right: 8, top: 4 }}
            >
              <CartesianGrid
                stroke="#F1F3F6"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="fecha"
                tick={{ fill: "#9CA3AF", fontSize: 10 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: "#9CA3AF", fontSize: 10 }}
                tickFormatter={(v: number) => fmtMillions(v)}
                tickLine={false}
                width={52}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
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
                          color: "#9CA3AF",
                          fontSize: 11,
                          marginBottom: 8,
                        }}
                      >
                        {String(label)}
                      </div>
                      {payload.map((p) => (
                        <div
                          key={String(p.name)}
                          style={{
                            alignItems: "center",
                            display: "flex",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{
                              background: String(p.color),
                              borderRadius: "50%",
                              display: "inline-block",
                              flexShrink: 0,
                              height: 7,
                              width: 7,
                            }}
                          />
                          <span style={{ color: "#6B7280", fontSize: 11 }}>
                            {p.name === "esperado" ? "Esperado" : "Real"}
                          </span>
                          <span
                            style={{
                              color: "#111827",
                              fontSize: 13,
                              fontVariantNumeric: "tabular-nums",
                              fontWeight: 700,
                              marginLeft: "auto",
                              paddingLeft: 16,
                            }}
                          >
                            {typeof p.value === "number"
                              ? fmtMoney(p.value)
                              : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Line
                activeDot={{
                  fill: "#3B82F6",
                  r: 4,
                  stroke: "#FFF",
                  strokeWidth: 2,
                }}
                dataKey="esperado"
                dot={false}
                stroke="#3B82F6"
                strokeDasharray="5 4"
                strokeWidth={2}
                type="monotone"
              />
              <Line
                activeDot={{
                  fill: "#059669",
                  r: 4,
                  stroke: "#FFF",
                  strokeWidth: 2,
                }}
                dataKey="real"
                dot={false}
                stroke="#059669"
                strokeWidth={2.5}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export function PerformanceDashboardView({ data }: { data: PerformanceData }) {
  const [selectedLinea, setSelectedLinea] = useState(data.lineas[0] ?? "");

  const maxMonto = Math.max(...data.rankingMonto.map((v) => v.monto), 1);
  const maxCantidad = Math.max(
    ...data.rankingCantidad.map((v) => v.cantidad),
    1,
  );

  return (
    <>
      {/* ── Fila 1: KPIs ──────────────────────────────────────────────── */}
      <FadeIn
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          marginBottom: 20,
        }}
      >
        <PerfKpiCard
          badge="Estado actual"
          badgeBg="#FFF4EE"
          badgeColor={BRAND}
          iconBg="#FFF4EE"
          label="Monto solicitado"
          trend={data.kpis.variacionSolicitado}
          value={fmtMoney(data.kpis.montoSolicitado)}
          iconEl={
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
              <rect
                height="18"
                rx="2"
                stroke={BRAND}
                strokeWidth="1.6"
                width="14"
                x="5"
                y="3"
              />
              <path
                d="M9 8h6M9 12h6M9 16h4"
                stroke={BRAND}
                strokeLinecap="round"
                strokeWidth="1.6"
              />
            </svg>
          }
        />
        <PerfKpiCard
          badge="Backlog activo"
          badgeBg="#ECFDF5"
          badgeColor="#059669"
          iconBg="#ECFDF5"
          label="Monto en gestión"
          trend={data.kpis.variacionGestion}
          value={fmtMoney(data.kpis.montoEnGestion)}
          iconEl={
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
              <path
                d="M3 17l5-6 4 4 8-9"
                stroke="#059669"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
              <path
                d="M16 7h5v5"
                stroke="#059669"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
            </svg>
          }
        />
        <PerfKpiCard
          badge="Período seleccionado"
          badgeBg="#EFF6FF"
          badgeColor="#3B82F6"
          iconBg="#EFF6FF"
          label="Enviado a tesorería"
          trend={data.kpis.variacionTesoreria}
          value={fmtMoney(data.kpis.montoEnviadoTesoreria)}
          iconEl={
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
              <path
                d="M12 3v14M8 13l4 4 4-4"
                stroke="#3B82F6"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
              <path
                d="M4 19h16"
                stroke="#3B82F6"
                strokeLinecap="round"
                strokeWidth="1.6"
              />
            </svg>
          }
        />
        <PerfKpiCard
          badge="Saldo en mora"
          badgeBg="#FEF2F2"
          badgeColor="#DC2626"
          iconBg="#FEF2F2"
          label="Mora total"
          trend={data.kpis.variacionMora}
          value={fmtMoney(data.kpis.moraTotal)}
          iconEl={
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
              <path
                d="M12 3L2 20h20L12 3z"
                stroke="#DC2626"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
              <path
                d="M12 9v5"
                stroke="#DC2626"
                strokeLinecap="round"
                strokeWidth="1.6"
              />
              <circle cx="12" cy="17" fill="#DC2626" r="0.8" />
            </svg>
          }
        />
        <PerfKpiCard
          badge="Capital disponible"
          badgeBg="#ECFDF5"
          badgeColor="#059669"
          iconBg="#ECFDF5"
          label="Dinero disponible para prestar"
          value={fmtMoney(data.kpis.dineroDisponible ?? 0)}
          iconEl={
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
              <rect
                height="14"
                rx="2"
                stroke="#059669"
                strokeWidth="1.6"
                width="20"
                x="2"
                y="5"
              />
              <circle
                cx="12"
                cy="12"
                r="3"
                stroke="#059669"
                strokeWidth="1.6"
              />
              <path
                d="M6 12h.01M18 12h.01"
                stroke="#059669"
                strokeLinecap="round"
                strokeWidth="1.6"
              />
            </svg>
          }
        />
      </FadeIn>

      {/* ── Proyección de cobranza ────────────────────────────────────── */}
      <FadeIn style={{ marginBottom: 20 }}>
        <CobranzaProyeccionCard />
      </FadeIn>

      {/* ── Fila 2: Monto total invertido (2/3) + Mora por línea (1/3) ───── */}
      <FadeIn
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "2fr 1fr",
          marginBottom: 20,
        }}
      >
        <PerfHistoricalChart
          historico={data.historico}
          lineas={data.lineas}
          onSelectLinea={setSelectedLinea}
          selectedLinea={selectedLinea}
        />
        <PerfMoraXLineaCard />
      </FadeIn>

      {/* ── Fila 3: Préstamos otorgados — ancho completo ─────────────────── */}
      <FadeIn style={{ marginBottom: 20 }}>
        <PerfPrestamosOtorgadosChart data={data.prestamosOtorgados} />
      </FadeIn>

      {/* ── Fila 4: Mora por antigüedad (1/2) + Ranking vendedores (1/2) ── */}
      <FadeIn
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 20,
        }}
      >
        <PerfMoraAntiguedadChart data={data.moraAntigüedad} />
        <PerfRankingVendedoresCard
          maxCantidad={maxCantidad}
          maxMonto={maxMonto}
          rankingCantidad={data.rankingCantidad}
          rankingMonto={data.rankingMonto}
        />
      </FadeIn>

      {/* ── Fila 5: Insights rápidos — ancho completo ────────────────── */}
      <FadeIn>
        <PerfInsightsCard resumen={data.resumen} />
      </FadeIn>
    </>
  );
}
