import { useCredixsaSolicitudQuery } from "@/modules/solicitudes-core/hooks/use-credixsa-solicitud-query";

const PLACEHOLDER = "-";

// El informe llega como JSON sin tipar desde CredixSA, via Kestra. Se leen
// solo los campos que se muestran y cada uno se valida al leerlo: si CredixSA
// cambia su HTML, el flow puede devolver una forma distinta sin avisar, y es
// preferible mostrar un bloque vacio antes que romper la pantalla.
type Informe = Record<string, unknown>;

type CredixsaInformeSectionProps = {
  isActive: boolean;
  solicitudId: string;
};

export function CredixsaInformeSection({
  isActive,
  solicitudId,
}: CredixsaInformeSectionProps) {
  const { data, error, isLoading } = useCredixsaSolicitudQuery(
    solicitudId,
    isActive,
  );
  const credixsa = data?.credixsa ?? null;
  const informe = (credixsa?.informe ?? null) as Informe | null;

  if (isLoading) {
    return (
      <Aviso texto="Consultando CredixSA... la primera consulta puede tardar hasta un minuto." />
    );
  }

  if (error || !credixsa) {
    return <Aviso texto="No se pudo consultar CredixSA." />;
  }

  if (!credixsa.ok || !informe) {
    return (
      <Aviso
        texto={
          credixsa.error ||
          (credixsa.status === "none"
            ? "CredixSA no encontro a esta persona."
            : credixsa.status === "multiple"
              ? "CredixSA devolvio mas de un resultado. Hay que consultarlo a mano."
              : "CredixSA no devolvio un informe.")
        }
      />
    );
  }

  const persona = objeto(informe.persona);
  const bcra = objeto(informe.bcra);
  const resumen = objeto(bcra?.resumen);
  const alertas = lista(informe.alertas);
  const quiebras = lista(informe.quiebras);

  return (
    <div className="space-y-3 p-3 md:p-4">
      <Bloque titulo="Persona">
        <Dato etiqueta="Nombre" valor={texto(persona?.nombre_completo)} />
        <Dato etiqueta="Documento" valor={texto(persona?.documento)} />
        <Dato etiqueta="CUIT" valor={texto(persona?.cuit)} />
        <Dato etiqueta="Edad" valor={texto(persona?.edad)} />
        <Dato etiqueta="Domicilio" valor={texto(persona?.domicilio)} />
      </Bloque>

      <Bloque titulo="BCRA">
        <Dato etiqueta="Situación" valor={texto(resumen?.color)} />
        <Dato etiqueta="Detalle" valor={texto(resumen?.detalle)} />
        <Dato
          etiqueta="Deuda vigente"
          valor={texto(bcra?.deuda_vigente_total)}
        />
      </Bloque>

      <Bloque titulo={`Alertas (${alertas.length})`}>
        {alertas.length > 0 ? (
          <ul className="col-span-full list-disc space-y-1 pl-5">
            {alertas.map((alerta, indice) => (
              <li key={indice}>{textoLibre(alerta)}</li>
            ))}
          </ul>
        ) : (
          <p className="col-span-full text-foreground-secondary">
            Sin alertas.
          </p>
        )}
      </Bloque>

      <Bloque titulo={`Quiebras (${quiebras.length})`}>
        {quiebras.length > 0 ? (
          <ul className="col-span-full list-disc space-y-1 pl-5">
            {quiebras.map((quiebra, indice) => (
              <li key={indice}>{textoLibre(quiebra)}</li>
            ))}
          </ul>
        ) : (
          <p className="col-span-full text-foreground-secondary">
            Sin quiebras registradas.
          </p>
        )}
      </Bloque>

      <p className="text-xs text-foreground-secondary">
        {credixsa.cacheHit
          ? `Informe consultado el ${credixsa.cachedAt.slice(0, 10)}.`
          : "Informe consultado recién."}
      </p>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <p className="p-4 text-sm text-foreground-secondary">{texto}</p>;
}

function Bloque({
  children,
  titulo,
}: {
  children: React.ReactNode;
  titulo: string;
}) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="border-b border-border px-3 py-2 text-xs font-medium uppercase text-foreground-secondary">
        {titulo}
      </header>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 p-3 text-sm md:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-foreground-secondary">{etiqueta}:</span>
      <span>{valor || PLACEHOLDER}</span>
    </div>
  );
}

function objeto(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function lista(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function texto(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

// Las alertas y quiebras vienen como texto suelto o como objeto, segun la
// seccion del informe. Se muestra lo que haya sin asumir una forma.
function textoLibre(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const registro = objeto(value);

  if (!registro) {
    return PLACEHOLDER;
  }

  return (
    texto(registro.detalle) ||
    texto(registro.titulo) ||
    texto(registro.descripcion) ||
    JSON.stringify(registro)
  );
}
