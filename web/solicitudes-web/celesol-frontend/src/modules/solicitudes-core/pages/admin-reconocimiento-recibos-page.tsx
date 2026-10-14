import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getConfiguracionReconocimiento,
  updateConfiguracionReconocimiento,
} from "../services/reconocimiento-recibos-api";
import { Button } from "@/shared/components/ui/button";
export function AdminReconocimientoRecibosPage() {
  const client = useQueryClient();
  const key = ["reconocimiento-recibos", "configuracion"];
  const query = useQuery({
    queryKey: key,
    queryFn: getConfiguracionReconocimiento,
  });
  const mutation = useMutation({
    mutationFn: updateConfiguracionReconocimiento,
    onSuccess: (data) => {
      client.setQueryData(key, data);
    },
  });
  return (
    <section className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">
        Reconocimiento automático de recibos de sueldo
      </h1>
      <p>
        Esta configuración se aplica a todo el sistema. La clasificación manual
        siempre está disponible.
      </p>
      {query.isPending ? (
        <p role="status">Cargando configuración…</p>
      ) : query.isError ? (
        <p role="alert">
          No se pudo consultar la configuración.{" "}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </p>
      ) : (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={
              mutation.isPending
                ? (mutation.variables ?? query.data.habilitado)
                : query.data.habilitado
            }
            disabled={mutation.isPending}
            onChange={(e) => mutation.mutate(e.target.checked)}
          />{" "}
          Habilitar reconocimiento automático
        </label>
      )}
      {mutation.isPending ? <p role="status">Guardando…</p> : null}
      {mutation.isError ? (
        <p role="alert">No se pudo guardar la configuración.</p>
      ) : mutation.isSuccess ? (
        <p role="status">Configuración guardada.</p>
      ) : null}
    </section>
  );
}
