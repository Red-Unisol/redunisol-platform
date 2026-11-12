import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SocioFormDialog } from "@/modules/socios/components/socio-form-dialog";
import { buildSocioPrefillFromTitular } from "@/modules/solicitudes-core/utils/build-socio-prefill-from-titular";
import type {
  CreateSocioRequest,
  UpdateSocioRequest,
} from "@/modules/socios/types";
import { PRODUCTION_SOLICITUD } from "./production-fixtures";

export function App() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<
    CreateSocioRequest | UpdateSocioRequest | null
  >(null);
  const initialValues = {
    ...buildSocioPrefillFromTitular({
      ...PRODUCTION_SOLICITUD.titular,
      apellidoDenominacion: "PRUEBA LOCAL",
      nombre: "SOCIO FICTICIO",
      cuit: "27991111242",
      nroDocumento: "99111124",
      fechaNacimiento: "1990-03-15",
      cbu: "0110000699111100000248",
      cbuNoHabitual: "0110000699111100000256",
    }),
    domicilioLocalidad: "12",
    domicilioCalle: "CALLE FICTICIA",
  };
  useEffect(() => {
    queryClient.setQueryData(["socio-localidades", "id", "12"], {
      id: "12",
      nombre: "LOCALIDAD DE PRUEBA",
      provincia: "Ejemplo",
      codigoPostal: "0000",
    });
  }, [queryClient]);
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-lg font-semibold">
        Alta de socio · Laboratorio local
      </h1>
      <p>Datos ficticios. Guardar sólo conserva el payload en esta página.</p>
      <button className="my-4 rounded border p-3" onClick={() => setOpen(true)}>
        Abrir alta de socio
      </button>
      {saved ? (
        <pre data-testid="saved-payload" className="whitespace-pre-wrap">
          {JSON.stringify(saved, null, 2)}
        </pre>
      ) : null}
      <SocioFormDialog
        initialValues={initialValues}
        isSaving={false}
        onOpenChange={setOpen}
        onSubmit={async (payload) => {
          setSaved(payload);
          setOpen(false);
        }}
        open={open}
        socio={null}
      />
    </main>
  );
}
