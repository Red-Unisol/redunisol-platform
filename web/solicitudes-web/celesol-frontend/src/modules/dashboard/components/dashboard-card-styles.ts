export type DashboardCardTone = "danger" | "neutral" | "warning";
export type DashboardPillTone = "danger" | "warning";

export function getDashboardCardToneStyles(tone: DashboardCardTone) {
  if (tone === "danger") {
    return {
      background: "#FEF2F2",
      border: "#FECACA",
      number: "#DC2626",
      text: "#991B1B",
    };
  }

  if (tone === "warning") {
    return {
      background: "#FFF7ED",
      border: "#FED7AA",
      number: "#C2410C",
      text: "#9A3412",
    };
  }

  return {
    background: "#F9FAFB",
    border: "#E5E7EB",
    number: "#374151",
    text: "#6B7280",
  };
}

export function getDashboardPillToneStyles(tone: DashboardPillTone) {
  if (tone === "danger") {
    return {
      background: "#FEF2F2",
      text: "#DC2626",
    };
  }

  return {
    background: "#FFFBEB",
    text: "#D97706",
  };
}

export function getDashboardMetricCardToneStyles(tone: DashboardCardTone) {
  const styles = getDashboardCardToneStyles(tone);

  return {
    background: styles.background,
    border: styles.border,
    label: styles.text,
    value: styles.number,
  };
}
