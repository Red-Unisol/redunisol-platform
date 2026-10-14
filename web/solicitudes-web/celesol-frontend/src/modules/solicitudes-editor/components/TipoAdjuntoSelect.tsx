import type { StyledSelectOption } from "../types";
import { StyledSelect } from "./fields/base";

export function TipoAdjuntoSelect({
  initialValue,
  onChange,
  options,
  value,
}: {
  initialValue?: string;
  onChange: (value: string) => void;
  options: StyledSelectOption[];
  value: string;
}) {
  const optionsConTipoOriginal =
    initialValue && !options.some((option) => option.value === initialValue)
      ? [...options, { label: initialValue, value: initialValue }]
      : options;

  return (
    <StyledSelect
      ariaLabel="Tipo de adjunto"
      onChange={onChange}
      options={optionsConTipoOriginal}
      placeholder="Seleccionar tipo"
      value={value}
    />
  );
}
