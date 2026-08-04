import {
  DashboardSectionCard as SectionCard,
  DashboardSectionHeader as SectionHeader,
} from "@/modules/dashboard/components/dashboard-section";

import {
  BarRow,
  EstadoBadge,
  FilterBar,
  KpiCard,
  SEL,
  TBODY_ROW,
  TD,
  TH,
} from "./dashboard-shared";

function FunnelRow({
  step,
  label,
  value,
  pct,
  color,
  textColor,
  mb = 6,
}: {
  step: string;
  label: string;
  value: number;
  pct: string;
  color: string;
  textColor: string;
  mb?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: mb,
      }}
    >
      <span style={{ fontSize: 10, color: "#bbb", width: 16, flexShrink: 0 }}>
        {step}
      </span>
      <span style={{ fontSize: 12, color: "#333", width: 130, flexShrink: 0 }}>
        {label}
      </span>
      <div
        style={{
          flex: 1,
          position: "relative",
          height: 22,
          background: "#f0f0f0",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ background: color, width: pct, height: "100%" }} />
        <span
          style={{
            position: "absolute",
            left: 8,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 11,
            color: textColor,
            fontWeight: 600,
          }}
        >
          {value}
        </span>
      </div>
      <span
        style={{ fontSize: 11, color: "#aaa", width: 34, textAlign: "right" }}
      >
        {pct}
      </span>
    </div>
  );
}

function RendRow({
  label,
  value,
  pct,
  extraPct,
  color = "#E87722",
}: {
  label: string;
  value: number;
  pct: string;
  extraPct: string;
  color?: string;
}) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
    >
      <span
        style={{
          fontSize: 11,
          color: "#444",
          width: 155,
          flexShrink: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          background: "#f0f0f0",
          borderRadius: 2,
          height: 11,
          overflow: "hidden",
        }}
      >
        <div style={{ background: color, width: pct, height: "100%" }} />
      </div>
      <span
        style={{ fontSize: 11, color: "#555", width: 30, textAlign: "right" }}
      >
        {value}
      </span>
      <span
        style={{ fontSize: 10, color: "#bbb", width: 34, textAlign: "right" }}
      >
        {extraPct}
      </span>
    </div>
  );
}

export function DashboardAdmin() {
  return (
    <div
      style={{
        padding: "20px 26px",
        animation: "fadeUp .15s ease-out",
        maxWidth: 1400,
        fontFamily: "system-ui,-apple-system,sans-serif",
        fontSize: 13,
        color: "#1a1a1a",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 13 }}>
        <div style={{ fontSize: 11, color: "#bbb", marginBottom: 3 }}>
          SOLICITUDES · ADMINISTRACIÓN
        </div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: "0 0 3px",
            color: "#1a1a1a",
          }}
        >
          Dashboard — Control general
        </h1>
        <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
          Vista global del sistema: operación, backlog, funnel y calidad de
          datos.
        </p>
      </div>

      {/* Filtros */}
      <FilterBar>
        <select style={SEL}>
          <option>Período: Jun 2026</option>
          <option>May 2026</option>
          <option>Q2 2026</option>
        </select>
        <select style={SEL}>
          <option>Línea: Todas</option>
          <option>AMEJUCA ESPECIAL</option>
          <option>NUEVOS CBU</option>
          <option>PROPIA RECURRENTE CBU</option>
        </select>
        <select style={SEL}>
          <option>Estado: Todos</option>
          <option>Carga Vendedor</option>
          <option>Revisión Riesgo</option>
          <option>Confirmada</option>
        </select>
        <select style={SEL}>
          <option>Owner/Área: Todos</option>
          <option>Vendedores</option>
          <option>Riesgo</option>
          <option>Tesorería</option>
        </select>
        <select style={SEL}>
          <option>Vendedor: Todos</option>
          <option>García, M.</option>
          <option>López, R.</option>
        </select>
        <select style={SEL}>
          <option>Asignado: Todos</option>
          <option>Martínez, J.</option>
          <option>Sosa, L.</option>
        </select>
      </FilterBar>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,1fr)",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <KpiCard
          label="Creadas (período)"
          value="284"
          sub={
            <span style={{ color: "#10B981", fontWeight: 500 }}>
              ↑ 8% vs mes ant.
            </span>
          }
        />
        <KpiCard label="Backlog activo" value="156" sub="en curso ahora" hero />
        <KpiCard
          label="Sin asignar"
          value="23"
          valueColor="#D97706"
          sub="requieren acción"
          dot="#F59E0B"
        />
        <KpiCard
          label="Detenidas >7 días"
          value="18"
          valueColor="#DC2626"
          sub="antigüedad aprox."
          border="1px solid #FECACA"
          dot="#EF4444"
        />
        <KpiCard
          label="Tasa de rechazo"
          value="12,4%"
          sub="del total período"
        />
        <KpiCard
          label="Tasa desestimación"
          value="8,1%"
          sub="del total período"
        />
      </div>

      {/* Charts Row 1: Backlog estado | Backlog owner + Calidad */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 11,
          marginBottom: 11,
        }}
      >
        <SectionCard>
          <SectionHeader
            title="Backlog por estado actual"
            sub="156 solicitudes"
          />
          <BarRow
            label="Carga Vendedor"
            value={45}
            color="#E87722"
            pct="100%"
          />
          <BarRow
            label="Revisión Riesgo"
            value={38}
            color="#3B82F6"
            pct="84%"
          />
          <BarRow label="Pre Aprobada" value={22} color="#10B981" pct="49%" />
          <BarRow label="Confirmada" value={19} color="#059669" pct="42%" />
          <BarRow label="Motor" value={12} color="#9CA3AF" pct="27%" />
          <BarRow label="Revisar" value={8} color="#F59E0B" pct="18%" />
          <BarRow label="Transferir" value={7} color="#6366F1" pct="16%" />
          <BarRow label="Otros" value={5} color="#D1D5DB" pct="11%" mb={0} />
        </SectionCard>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <SectionCard style={{ flex: 1 }}>
            <SectionHeader title="Backlog por Owner / Área" sub="activos" />
            <BarRow
              label="Vendedores"
              value={85}
              color="#E87722"
              pct="100%"
              labelW={100}
              valueW={26}
            />
            <BarRow
              label="Riesgo"
              value={57}
              color="#3B82F6"
              pct="67%"
              labelW={100}
              valueW={26}
            />
            <BarRow
              label="Sistema"
              value={12}
              color="#9CA3AF"
              pct="14%"
              labelW={100}
              valueW={26}
            />
            <BarRow
              label="Tesorería"
              value={7}
              color="#6366F1"
              pct="8%"
              labelW={100}
              valueW={26}
            />
            <BarRow
              label="Sin owner"
              value={15}
              color="#EF4444"
              pct="18%"
              labelW={100}
              valueW={26}
              valueColor="#DC2626"
              bold
              italic
              mb={0}
            />
          </SectionCard>

          <div
            style={{
              background: "white",
              border: "1px solid #e0e0e0",
              borderRadius: 4,
              padding: "13px 17px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 11 }}>
              Calidad de datos{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "#bbb" }}>
                · issues detectados
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 7,
              }}
            >
              {[
                {
                  n: 15,
                  label: "Sin línea asignada",
                  bg: "#FFF7ED",
                  border: "#FED7AA",
                  numColor: "#C2410C",
                  txtColor: "#9A3412",
                },
                {
                  n: 8,
                  label: "Sin ejecutivo",
                  bg: "#FFF7ED",
                  border: "#FED7AA",
                  numColor: "#C2410C",
                  txtColor: "#9A3412",
                },
                {
                  n: 23,
                  label: "Sin asignado",
                  bg: "#FEF2F2",
                  border: "#FECACA",
                  numColor: "#DC2626",
                  txtColor: "#991B1B",
                },
                {
                  n: 11,
                  label: "Links firma faltantes",
                  bg: "#FFFBEB",
                  border: "#FDE68A",
                  numColor: "#92400E",
                  txtColor: "#78350F",
                },
              ].map(({ n, label, bg, border, numColor, txtColor }) => (
                <div
                  key={label}
                  style={{
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 3,
                    padding: "7px 10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      color: numColor,
                      lineHeight: 1,
                    }}
                  >
                    {n}
                  </div>
                  <div style={{ fontSize: 10, color: txtColor, marginTop: 3 }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row 2: Funnel + Rendimiento | Resultados negativos */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 11,
          marginBottom: 11,
        }}
      >
        <SectionCard>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 13 }}>
            Funnel general de solicitudes{" "}
            <span style={{ fontSize: 11, fontWeight: 400, color: "#bbb" }}>
              · período
            </span>
          </div>
          <FunnelRow
            step="01"
            label="Creadas"
            value={284}
            pct="100%"
            color="#E87722"
            textColor="white"
          />
          <FunnelRow
            step="02"
            label="Confirmadas"
            value={89}
            pct="31%"
            color="#059669"
            textColor="#059669"
          />
          <FunnelRow
            step="03"
            label="Liquidadas"
            value={67}
            pct="24%"
            color="#065F46"
            textColor="#065F46"
          />
          <FunnelRow
            step="04"
            label="Verif. / Firma"
            value={31}
            pct="11%"
            color="#4F46E5"
            textColor="#4F46E5"
          />
          <FunnelRow
            step="05"
            label="Transferidas"
            value={24}
            pct="8%"
            color="#7C3AED"
            textColor="#7C3AED"
            mb={13}
          />

          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: ".3px",
                marginBottom: 9,
              }}
            >
              Rendimiento por línea de préstamo
            </div>
            <RendRow
              label="PROPIA RECURRENTE CBU"
              value={124}
              pct="100%"
              extraPct="43,7%"
            />
            <RendRow
              label="NUEVOS CBU"
              value={87}
              pct="70%"
              extraPct="30,6%"
              color="#3B82F6"
            />
            <RendRow
              label="AMEJUCA ESPECIAL"
              value={56}
              pct="45%"
              extraPct="19,7%"
              color="#10B981"
            />
            <RendRow
              label="Otras"
              value={17}
              pct="14%"
              extraPct="6%"
              color="#D1D5DB"
            />
          </div>
        </SectionCard>

        <SectionCard>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 13 }}>
            Resultados negativos
          </div>
          {[
            {
              label: "Rechazada",
              n: 35,
              pct: "12,3%",
              bg: "#FEF2F2",
              border: "#FECACA",
              labelColor: "#991B1B",
              numColor: "#DC2626",
            },
            {
              label: "Desestimada",
              n: 23,
              pct: "8,1%",
              bg: "#FFF7ED",
              border: "#FED7AA",
              labelColor: "#9A3412",
              numColor: "#C2410C",
            },
            {
              label: "Vencida",
              n: 14,
              pct: "4,9%",
              bg: "#F9FAFB",
              border: "#E5E7EB",
              labelColor: "#6B7280",
              numColor: "#374151",
            },
          ].map(({ label, n, pct, bg, border, labelColor, numColor }) => (
            <div
              key={label}
              style={{
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 4,
                padding: "10px 13px",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: labelColor,
                  textTransform: "uppercase",
                  letterSpacing: ".3px",
                  marginBottom: 3,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: 24,
                  color: numColor,
                  lineHeight: 1,
                }}
              >
                {n}
              </div>
              <div style={{ fontSize: 11, color: "#bbb", marginTop: 3 }}>
                {pct} del período
              </div>
            </div>
          ))}
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 10 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#555",
                marginBottom: 6,
              }}
            >
              Total negativos: 72 (25,4%)
            </div>
            <div
              style={{
                height: 7,
                background: "#f0f0f0",
                borderRadius: 4,
                overflow: "hidden",
                display: "flex",
              }}
            >
              <div style={{ background: "#DC2626", width: "48.6%" }} />
              <div style={{ background: "#C2410C", width: "31.9%" }} />
              <div style={{ background: "#9CA3AF", width: "19.4%" }} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              {[
                ["#DC2626", "Rechazadas"],
                ["#C2410C", "Desestimadas"],
                ["#9CA3AF", "Vencidas"],
              ].map(([color, label]) => (
                <span
                  key={label}
                  style={{
                    fontSize: 10,
                    color,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      background: color,
                      borderRadius: 1,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Tables Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 11,
          marginBottom: 24,
        }}
      >
        {/* Solicitudes más antiguas */}
        <SectionCard>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 11,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Solicitudes más antiguas activas
            </span>
            <span style={{ fontSize: 11, color: "#E87722", cursor: "pointer" }}>
              Ver todas →
            </span>
          </div>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #e8e8e8" }}>
                <th style={TH}>Titular</th>
                <th style={TH}>Línea</th>
                <th style={TH}>Estado</th>
                <th style={{ ...TH, textAlign: "right" }}>Antigüedad</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  nombre: "Fernández, R.",
                  linea: "NUEVOS CBU",
                  estado: "Revisar",
                  dias: "≈ 21 días",
                  color: "#DC2626",
                },
                {
                  nombre: "Gómez, A.",
                  linea: "AMEJUCA ESPECIAL",
                  estado: "Revisión Riesgo",
                  dias: "≈ 18 días",
                  color: "#DC2626",
                },
                {
                  nombre: "Ruiz, C.",
                  linea: "PROPIA RECURRENTE CBU",
                  estado: "Pre Aprobada",
                  dias: "≈ 15 días",
                  color: "#D97706",
                },
                {
                  nombre: "Martínez, B.",
                  linea: "NUEVOS CBU",
                  estado: "Carga Vendedor",
                  dias: "≈ 13 días",
                  color: "#D97706",
                },
                {
                  nombre: "Pérez, L.",
                  linea: "AMEJUCA ESPECIAL",
                  estado: "Revisión Riesgo",
                  dias: "≈ 12 días",
                  color: "#D97706",
                },
              ].map(({ nombre, linea, estado, dias, color }, i, arr) => (
                <tr key={nombre} style={i < arr.length - 1 ? TBODY_ROW : {}}>
                  <td style={TD}>
                    <span style={{ fontWeight: 500 }}>{nombre}</span>
                  </td>
                  <td style={{ ...TD, color: "#777", fontSize: 11 }}>
                    {linea}
                  </td>
                  <td style={TD}>
                    <EstadoBadge estado={estado} />
                  </td>
                  <td
                    style={{
                      ...TD,
                      textAlign: "right",
                      color,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {dias}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        {/* Usuarios sin owner + FieldAccess */}
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <SectionCard>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 11,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Usuarios pendientes de Owner/Área
              </span>
              <span
                style={{
                  background: "#FEF2F2",
                  color: "#DC2626",
                  borderRadius: 10,
                  padding: "1px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                3
              </span>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #e8e8e8" }}>
                  <th style={TH}>Usuario</th>
                  <th style={TH}>Rol</th>
                  <th style={{ ...TH, textAlign: "right" }}>Creado</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { nombre: "Rojas, M.", rol: "Vendedor", fecha: "14/06/2026" },
                  { nombre: "Díaz, P.", rol: "Analista", fecha: "10/06/2026" },
                  {
                    nombre: "Torres, V.",
                    rol: "Vendedor",
                    fecha: "03/06/2026",
                  },
                ].map(({ nombre, rol, fecha }, i, arr) => (
                  <tr key={nombre} style={i < arr.length - 1 ? TBODY_ROW : {}}>
                    <td style={TD}>
                      <span style={{ fontWeight: 500 }}>{nombre}</span>
                    </td>
                    <td style={{ ...TD, color: "#666" }}>{rol}</td>
                    <td
                      style={{
                        ...TD,
                        textAlign: "right",
                        color: "#999",
                        fontSize: 11,
                      }}
                    >
                      {fecha}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 11,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Cambios recientes de FieldAccess
              </span>
              <span
                style={{ fontSize: 11, color: "#E87722", cursor: "pointer" }}
              >
                Ver historial →
              </span>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #e8e8e8" }}>
                  <th style={TH}>Estado</th>
                  <th style={TH}>Modificado por</th>
                  <th style={{ ...TH, textAlign: "right" }}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    estado: "Confirmada",
                    admin: "admin.sosa",
                    fecha: "21/06/2026",
                  },
                  {
                    estado: "Carga Vendedor",
                    admin: "admin.sosa",
                    fecha: "18/06/2026",
                  },
                  {
                    estado: "Revisar",
                    admin: "admin.torres",
                    fecha: "15/06/2026",
                  },
                ].map(({ estado, admin, fecha }, i, arr) => (
                  <tr
                    key={`${estado}-${fecha}`}
                    style={i < arr.length - 1 ? TBODY_ROW : {}}
                  >
                    <td style={TD}>
                      <EstadoBadge estado={estado} />
                    </td>
                    <td style={{ ...TD, color: "#666" }}>{admin}</td>
                    <td
                      style={{
                        ...TD,
                        textAlign: "right",
                        color: "#999",
                        fontSize: 11,
                      }}
                    >
                      {fecha}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
