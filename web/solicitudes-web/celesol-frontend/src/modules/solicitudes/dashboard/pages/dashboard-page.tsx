import { useState } from "react";

import { DashboardAdmin } from "../components/dashboard-admin";
import { DashboardAnalista } from "../components/dashboard-analista";
import { DashboardVendedor } from "../components/dashboard-vendedor";

type Tab = "admin" | "vendedor" | "analista";

const ROLE_COLORS: Record<Tab, string> = {
  admin: "#E87722",
  vendedor: "#3B82F6",
  analista: "#059669",
};

const TAB_BASE: React.CSSProperties = {
  padding: "0 16px",
  fontSize: 13,
  border: "none",
  cursor: "pointer",
  height: 44,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  borderBottom: "2px solid transparent",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  color: "#555",
};

const activeTabStyle = (t: Tab): React.CSSProperties => ({
  ...TAB_BASE,
  color: ROLE_COLORS[t],
  borderBottomColor: ROLE_COLORS[t],
  fontWeight: 600,
});

export function DashboardPage() {
  const [tab, setTab] = useState<Tab>("admin");
  const roleColor = ROLE_COLORS[tab];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      <div
        style={{
          background: "white",
          borderBottom: "1px solid #e0e0e0",
          display: "flex",
          alignItems: "stretch",
          padding: "0 16px",
          flexShrink: 0,
          height: 44,
        }}
      >
        <button
          type="button"
          onClick={() => setTab("admin")}
          style={tab === "admin" ? activeTabStyle("admin") : TAB_BASE}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect
              x=".8"
              y=".8"
              width="4.4"
              height="4.4"
              rx=".8"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x="6.8"
              y=".8"
              width="4.4"
              height="4.4"
              rx=".8"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x=".8"
              y="6.8"
              width="4.4"
              height="4.4"
              rx=".8"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x="6.8"
              y="6.8"
              width="4.4"
              height="4.4"
              rx=".8"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          Administrador
        </button>

        <button
          type="button"
          onClick={() => setTab("vendedor")}
          style={tab === "vendedor" ? activeTabStyle("vendedor") : TAB_BASE}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 2.5h8a1 1 0 011 1v4a1 1 0 01-1 1H2V2.5z"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M4.5 8.5v2M7.5 8.5v2M3 10.5h6"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          Vendedor
        </button>

        <button
          type="button"
          onClick={() => setTab("analista")}
          style={tab === "analista" ? activeTabStyle("analista") : TAB_BASE}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 9.5l2.5-4 2.5 2L9 2.5l2 3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Analista
        </button>

        <div
          style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}
        >
          <span
            style={{
              background: "#F5F3FF",
              color: "#7C3AED",
              border: "1px dashed #C4B5FD",
              borderRadius: 3,
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.3px",
            }}
          >
            WIREFRAME · BORRADOR
          </span>
        </div>
      </div>

      {/* Scrollable content area — sets --role-color for all children */}
      <div
        key={tab}
        style={
          {
            flex: 1,
            overflowY: "auto",
            background: "#F0F2F5",
            borderTop: `3px solid ${roleColor}`,
            "--role-color": roleColor,
          } as React.CSSProperties
        }
      >
        {tab === "admin" && <DashboardAdmin />}
        {tab === "vendedor" && <DashboardVendedor />}
        {tab === "analista" && <DashboardAnalista />}
      </div>
    </div>
  );
}
