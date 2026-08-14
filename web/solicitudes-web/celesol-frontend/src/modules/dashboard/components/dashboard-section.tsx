import type { CSSProperties, ReactNode } from "react";

export function DashboardSectionCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e0e0e0",
        borderRadius: 4,
        padding: "15px 17px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function DashboardSectionHeader({
  action,
  sub,
  title,
}: {
  action?: ReactNode;
  sub?: string;
  title: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 13,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      {action ??
        (sub ? (
          <span style={{ color: "#bbb", fontSize: 11 }}>{sub}</span>
        ) : null)}
    </div>
  );
}
