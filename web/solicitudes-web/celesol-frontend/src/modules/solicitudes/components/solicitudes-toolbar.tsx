import {
  ArchiveRestore,
  ArchiveX,
  ArrowDownToLine,
  type LucideIcon,
  BookUser,
  Calculator,
  Ellipsis,
  FileSpreadsheet,
  RefreshCw,
  Search,
  ShieldAlert,
  TableConfig,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export type SolicitudesToolbarAction = {
  disabled?: boolean;
  icon?: LucideIcon;
  id: string;
  label?: string;
  primary?: boolean;
};

type SolicitudesToolbarProps = {
  leftActions?: SolicitudesToolbarAction[];
  onAction?: (actionId: string) => void;
  onSimularIntent?: () => void;
  onSearchChange: (value: string) => void;
  rightActions?: SolicitudesToolbarAction[];
  searchTerm: string;
};

const DEFAULT_LEFT_ACTIONS: SolicitudesToolbarAction[] = [
  { icon: Calculator, id: "simulador", label: "Simulador" },
];

const DEFAULT_RIGHT_ACTIONS: SolicitudesToolbarAction[] = [
  { id: "borrar-mover", label: "Borrar/Mover" },
  { icon: TableConfig, id: "exportar-config", label: "Exportar Config" },
  { icon: FileSpreadsheet, id: "exportar-xml", label: "Exportar XML" },
  { icon: BookUser, id: "directorio", label: "Directorio" },
  {
    disabled: true,
    icon: ArchiveX,
    id: "archivar-solicitud",
    label: "Archivar Solicitud",
  },
  {
    icon: ArchiveRestore,
    id: "desarchivar-solicitud",
    label: "Desarchivar Solicitud",
  },
  { icon: ArrowDownToLine, id: "obtener", label: "Obtener" },
  { icon: ShieldAlert, id: "consultar-uif", label: "Consultar UIF" },
  { icon: RefreshCw, id: "refresh" },
  { icon: Ellipsis, id: "more-actions" },
];

export function SolicitudesToolbar({
  leftActions = DEFAULT_LEFT_ACTIONS,
  onAction,
  onSimularIntent,
  onSearchChange,
  rightActions = DEFAULT_RIGHT_ACTIONS,
  searchTerm,
}: SolicitudesToolbarProps) {
  return (
    <div className="border-b border-border bg-linear-to-b from-white to-background/70 px-3 py-2">
      <div className="flex w-full flex-wrap items-center gap-2">
        {leftActions.map((action) => {
          const isIconOnly = !action.label;

          return (
            <Button
              className={action.primary ? "" : "text-foreground"}
              disabled={action.disabled}
              key={action.id}
              onClick={() => onAction?.(action.id)}
              onFocus={action.id === "simulador" ? onSimularIntent : undefined}
              onMouseEnter={
                action.id === "simulador" ? onSimularIntent : undefined
              }
              onPointerDown={
                action.id === "simulador" ? onSimularIntent : undefined
              }
              size={isIconOnly ? "icon-sm" : "sm"}
              type="button"
              variant={action.primary ? "default" : "outline"}
            >
              {action.icon ? <action.icon className="size-4" /> : null}
              {action.label}
            </Button>
          );
        })}

        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
          <Input
            className="pl-9"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Texto a buscar"
            value={searchTerm}
          />
        </div>

        {rightActions.map((action) => {
          const isIconOnly = !action.label;

          return (
            <Button
              className={action.primary ? "" : "text-foreground"}
              disabled={action.disabled}
              key={action.id}
              onClick={() => onAction?.(action.id)}
              size={isIconOnly ? "icon-sm" : "sm"}
              type="button"
              variant={action.primary ? "default" : "outline"}
            >
              {action.icon ? <action.icon className="size-4" /> : null}
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
