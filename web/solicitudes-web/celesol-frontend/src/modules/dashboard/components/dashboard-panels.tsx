import type { ReactNode } from "react";

import { DashboardCountPill } from "@/modules/dashboard/components/dashboard-card-primitives";
import {
  getDashboardPanelToneStyles,
  type DashboardPanelTone,
} from "@/modules/dashboard/components/dashboard-panel-styles";

export function DashboardTonedPanel({
  badge,
  badgeTone,
  children,
  title,
  tone,
}: {
  badge?: ReactNode;
  badgeTone?: "danger" | "warning";
  children: ReactNode;
  title: string;
  tone: DashboardPanelTone;
}) {
  const styles = getDashboardPanelToneStyles(tone);

  return (
    <div
      style={{
        background: "white",
        border: `1px solid ${styles.border}`,
        borderRadius: 4,
        padding: "15px 17px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 11,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {badge != null && badgeTone ? (
          <DashboardCountPill tone={badgeTone}>{badge}</DashboardCountPill>
        ) : null}
      </div>
      {children}
    </div>
  );
}
