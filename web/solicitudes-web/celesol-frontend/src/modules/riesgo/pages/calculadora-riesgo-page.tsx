import { useState } from "react";

import { CalculadoraMutualSheet } from "../components/CalculadoraMutualSheet";

export function CalculadoraRiesgoPage() {
  // Al traer o restaurar una version, se vuelve a montar la planilla para que
  // cargue la nueva.
  const [version, setVersion] = useState(0);

  return (
    <CalculadoraMutualSheet
      key={version}
      onCalculadoraActualizada={() => setVersion((actual) => actual + 1)}
      source={{ kind: "standalone" }}
    />
  );
}
