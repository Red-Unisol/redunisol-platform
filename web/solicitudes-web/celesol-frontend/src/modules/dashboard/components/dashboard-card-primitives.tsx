import type { ReactNode } from "react";

import {
  getDashboardCardToneStyles,
  getDashboardMetricCardToneStyles,
  getDashboardPillToneStyles,
  type DashboardCardTone,
  type DashboardPillTone,
} from "@/modules/dashboard/components/dashboard-card-styles";

export function DashboardCompactStatCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: DashboardCardTone;
  value: number | string;
}) {
  const styles = getDashboardCardToneStyles(tone);

  return (
    <div
      style={{
        background: styles.background,
        border: `1px solid ${styles.border}`,
        borderRadius: 3,
        padding: "8px 10px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: styles.number,
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ color: styles.text, fontSize: 10, marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}

export function DashboardCountPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: DashboardPillTone;
}) {
  const styles = getDashboardPillToneStyles(tone);

  return (
    <span
      style={{
        background: styles.background,
        borderRadius: 10,
        color: styles.text,
        fontSize: 11,
        fontWeight: 600,
        padding: "1px 8px",
      }}
    >
      {children}
    </span>
  );
}

export function DashboardMetricCard({
  description,
  label,
  tone,
  value,
}: {
  description: string;
  label: string;
  tone: DashboardCardTone;
  value: number | string;
}) {
  const styles = getDashboardMetricCardToneStyles(tone);

  return (
    <div
      style={{
        background: styles.background,
        border: `1px solid ${styles.border}`,
        borderRadius: 4,
        marginBottom: 8,
        padding: "10px 13px",
      }}
    >
      <div
        style={{
          color: styles.label,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".3px",
          marginBottom: 3,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: styles.value,
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ color: "#bbb", fontSize: 11, marginTop: 3 }}>
        {description}
      </div>
    </div>
  );
}
