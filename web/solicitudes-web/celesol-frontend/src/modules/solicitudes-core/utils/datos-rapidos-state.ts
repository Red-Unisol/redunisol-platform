type QueryState<T> = { data?: T; isPending: boolean; isError: boolean };
export function socioIndicator(query: QueryState<{ condicion: string }>) {
  if (query.isPending)
    return {
      text: "Consultando condición de socio",
      member: false,
      variant: "neutral" as const,
    };
  if (
    query.isError ||
    !["member", "none"].includes(query.data?.condicion ?? "")
  ) {
    return {
      text: "No se pudo verificar",
      member: false,
      variant: "warning" as const,
    };
  }
  return query.data?.condicion === "member"
    ? { text: "Es socio", member: true, variant: "success" as const }
    : { text: "No es socio", member: false, variant: "neutral" as const };
}
export function creditosIndicator(
  query: QueryState<{ activos: boolean | null }>,
) {
  if (query.isPending)
    return { text: "Consultando créditos", variant: "neutral" as const };
  if (query.isError || typeof query.data?.activos !== "boolean") {
    return { text: "No se pudo verificar", variant: "warning" as const };
  }
  return {
    text: query.data.activos ? "Tiene" : "No tiene",
    variant: "neutral" as const,
  };
}
