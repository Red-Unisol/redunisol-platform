export type DashboardPanelTone = "danger" | "neutral" | "warning";

export function getDashboardPanelToneStyles(tone: DashboardPanelTone) {
  if (tone === "warning") {
    return {
      border: "#FDE68A",
    };
  }

  if (tone === "danger") {
    return {
      border: "#FECACA",
    };
  }

  return {
    border: "#e0e0e0",
  };
}
