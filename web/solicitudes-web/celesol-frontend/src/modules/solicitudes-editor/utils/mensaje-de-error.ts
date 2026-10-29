// Mensaje para mostrar debajo del campo. "X es requerido" repite la etiqueta
// que ya esta arriba: alcanza con pedir el dato. Los demas motivos ("La linea
// permite hasta 6 cuotas.") se muestran tal cual.
export function mensajeDeError(
  errors?: Partial<Record<string, { message?: string }>>,
) {
  return (key: string) => {
    if (!errors?.[key]) return undefined;
    const message = errors[key]?.message?.trim();
    return !message || /es requerid[oa]\.?$/i.test(message)
      ? "Completá este dato."
      : message;
  };
}
