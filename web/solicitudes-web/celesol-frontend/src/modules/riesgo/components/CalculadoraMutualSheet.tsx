import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";

import type { FWorkbook } from "@univerjs/preset-sheets-core";
import {
  CalculationMode,
  UniverSheetsCorePreset,
} from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEsES from "@univerjs/preset-sheets-core/locales/es-ES";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import UniverPresetSheetsDrawingEsES from "@univerjs/preset-sheets-drawing/locales/es-ES";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import type { FUniver, IWorkbookData, Univer } from "@univerjs/presets";
import LuckyExcel from "@zwight/luckyexcel";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { ApiError } from "@/shared/services/http/api-error";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";

import {
  buildCalculadoraDatosCellWrites,
  CALCULADORA_DATOS_SHEET_NAME,
} from "../pages/calculadora-riesgo-datos-mapping";
import {
  resolveCalculadoraSheetZoom,
  resolveInitialCalculadoraSheetName,
} from "../pages/calculadora-riesgo-view-config";
import { stripLuckyExcelSpuriousBorders } from "../pages/calculadora-riesgo-workbook-fixes";
import {
  getCalculadoraMutualDatos,
  getCalculadoraMutualDatosByCoreId,
  getCalculadoraRiesgoFile,
  getEvaluacionRiesgo,
  guardarEvaluacionRiesgo,
  type EvaluacionRiesgo,
} from "../services/riesgo-api";

export type CalculadoraMutualSheetSource =
  | { kind: "standalone" }
  | { kind: "embedded"; solicitudId: string };

type CalculadoraMutualSheetProps = {
  className?: string;
  /** Avisa al detalle si hay cambios sin guardar, para frenar el cambio de pestaña. */
  onCambiosSinGuardarChange?: (hayCambios: boolean) => void;
  /** Riesgo con la solicitud a cargo, o admin. El backend vuelve a chequearlo. */
  puedeGuardar?: boolean;
  source: CalculadoraMutualSheetSource;
};

type EvaluacionGuardadaInfo = Omit<EvaluacionRiesgo, "snapshot">;

// Nivel de riesgo que da la planilla (Evaluacion!D30): un entero de 1 a 5. El
// legado lo grababa en la solicitud con STOREXP("NivelRiesgo", ...).
function leerNivelRiesgo(workbook: FWorkbook) {
  const valor = Number(
    workbook.getSheetByName("Evaluacion")?.getRange("D30").getValue(),
  );

  return Number.isInteger(valor) && valor >= 1 && valor <= 5 ? valor : null;
}

function formatGuardada(info: EvaluacionGuardadaInfo) {
  const fecha = new Date(info.guardadaEn).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const quien = info.guardadaPor ? ` por ${info.guardadaPor.nombre}` : "";

  return `Guardada${quien} el ${fecha}`;
}

export function CalculadoraMutualSheet({
  className,
  onCambiosSinGuardarChange,
  puedeGuardar = false,
  source,
}: CalculadoraMutualSheetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workbookRef = useRef<FWorkbook | null>(null);
  const univerApiRef = useRef<FUniver | null>(null);
  const cambiosListenerRef = useRef<{ dispose: () => void } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [solicitudOid, setSolicitudOid] = useState("");
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [evaluacionGuardada, setEvaluacionGuardada] =
    useState<EvaluacionGuardadaInfo | null>(null);
  const [hayCambios, setHayCambios] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    onCambiosSinGuardarChange?.(hayCambios);
  }, [hayCambios, onCambiosSinGuardarChange]);

  useEffect(() => {
    if (!hayCambios) {
      return;
    }

    // Cerrar o recargar el navegador con cambios: el navegador pregunta.
    function avisar(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [hayCambios]);

  useEffect(() => {
    let isMounted = true;
    let univerInstance: Univer | null = null;
    let objectUrl: string | null = null;

    async function load() {
      try {
        // Si la solicitud ya tiene una evaluacion guardada se abre esa, con lo
        // que cargo Riesgo; si no, la plantilla. Si no se puede leer la
        // guardada no se abre la plantilla: guardarla pisaria la anterior.
        const guardada =
          source.kind === "embedded"
            ? await getEvaluacionRiesgo(source.solicitudId)
            : null;

        if (isMounted && guardada) {
          setEvaluacionGuardada({
            guardadaEn: guardada.guardadaEn,
            guardadaPor: guardada.guardadaPor,
            nivelRiesgo: guardada.nivelRiesgo,
          });
        }

        const blob = await getCalculadoraRiesgoFile();
        objectUrl = URL.createObjectURL(blob);

        if (isMounted) {
          setDownloadUrl(objectUrl);
        }

        const file = new File([blob], "CALCULADORA MUTUAL.xlsx", {
          type: blob.type,
        });

        const montar = (workbookData: IWorkbookData) => {
          if (!isMounted || !containerRef.current) {
            return;
          }

          const { univer, univerAPI } = createUniver({
            locale: LocaleType.ES_ES,
            locales: {
              [LocaleType.ES_ES]: mergeLocales(
                UniverPresetSheetsCoreEsES,
                UniverPresetSheetsDrawingEsES,
              ),
            },
            presets: [
              UniverSheetsCorePreset({
                container: containerRef.current,
                customFontFamily: {
                  list: [
                    {
                      value: "Calibri",
                      label: "Calibri",
                    },
                  ],
                  override: false,
                },
                disableAutoFocus: true,
                footer: {
                  menus: false,
                  sheetBar: true,
                  statisticBar: false,
                  zoomSlider: true,
                },
                formulaBar: false,
                header: false,
                toolbar: false,
              }),
              UniverSheetsDrawingPreset(),
            ],
          });

          univerInstance = univer;
          univerAPI.createWorkbook(workbookData);

          const workbook = univerAPI.getActiveWorkbook();
          workbookRef.current = workbook ?? null;
          univerApiRef.current = univerAPI;
          const sheets = workbook?.getSheets() ?? [];

          sheets.forEach((sheet) => {
            sheet.zoom(resolveCalculadoraSheetZoom(sheet.getSheetName()));
          });

          const initialSheetName = resolveInitialCalculadoraSheetName(
            sheets.map((sheet) => sheet.getSheetName()),
          );
          const initialSheet = initialSheetName
            ? workbook?.getSheetByName(initialSheetName)
            : null;

          if (workbook && initialSheet) {
            workbook.setActiveSheet(initialSheet);
            initialSheet.scrollToCell(0, 0);
            initialSheet.getRange("A1").activate();
          }

          // Se activa isHydrating en el mismo render que isLoading pasa a
          // false (para el caso embedded) para que la transición entre los
          // dos loaders sea continua. Si no, hay un render intermedio -- el
          // efecto de auto-hidratación recién corre en el próximo tick --
          // donde ninguno de los dos está activo y se ve la planilla sin
          // hidratar por un instante.
          if (source.kind === "embedded") {
            setIsHydrating(true);
          }
          setIsLoading(false);
        };

        if (guardada) {
          montar(guardada.snapshot as IWorkbookData);
          return;
        }

        LuckyExcel.transformExcelToUniver(
          file,
          (workbookData: IWorkbookData) =>
            montar(
              stripLuckyExcelSpuriousBorders({
                ...workbookData,
                styles: workbookData.styles ?? {},
              }),
            ),
          (conversionError: Error) => {
            if (!isMounted) {
              return;
            }

            setErrorMessage(
              conversionError.message ||
                "No se pudo procesar el archivo de la calculadora.",
            );
            setIsLoading(false);
          },
        );
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(
          error instanceof ApiError || error instanceof Error
            ? error.message
            : "No se pudo cargar la calculadora de riesgo.",
        );
        setIsLoading(false);
      }
    }

    void load();

    return () => {
      isMounted = false;
      workbookRef.current = null;
      univerApiRef.current = null;
      cambiosListenerRef.current?.dispose();
      cambiosListenerRef.current = null;

      // Univer desarma su propio árbol de React internamente al hacer
      // dispose(). Si eso corre en medio del ciclo de render/commit de
      // React (p.ej. bajo StrictMode, que monta/desmonta efectos dos veces
      // seguidas), React aborta ese render a mitad de camino -- y con él,
      // el setIsLoading(false) que dispara la auto-hidratación. Diferirlo
      // saca el dispose() del commit actual.
      if (univerInstance) {
        const instanceToDispose = univerInstance;
        setTimeout(() => instanceToDispose.dispose(), 0);
      }

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // Carga el archivo base una sola vez al montar; `source.kind` solo se
    // lee para decidir si primeria isHydrating, no debe re-disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hydrate(
    fetchDatos: () => ReturnType<typeof getCalculadoraMutualDatos>,
  ) {
    const workbook = workbookRef.current;

    if (!workbook) {
      setHydrationError("La calculadora todavía no terminó de cargar.");
      return;
    }

    const datosSheet = workbook.getSheetByName(CALCULADORA_DATOS_SHEET_NAME);

    if (!datosSheet) {
      setHydrationError(
        `No se encontró la hoja "${CALCULADORA_DATOS_SHEET_NAME}" en la calculadora.`,
      );
      return;
    }

    setIsHydrating(true);
    setHydrationError(null);

    try {
      const datos = await fetchDatos();
      const writes = buildCalculadoraDatosCellWrites(datos);

      for (const write of writes) {
        datosSheet.getRange(write.cell).setValue(write.value);
      }

      const formulaEngine = univerApiRef.current?.getFormula();
      // Por defecto Univer usa CalculationMode.WHEN_EMPTY: solo recalcula
      // fórmulas que NO tienen un valor cacheado todavía. Como el Excel
      // original ya trae un valor cacheado (el texto de error del legado)
      // en casi todas las celdas, nunca se recalculaban solas. Forzamos
      // CalculationMode.FORCED para que recalculen todas, tengan o no
      // valor cacheado.
      formulaEngine?.setInitialFormulaComputing(CalculationMode.FORCED);
      formulaEngine?.executeCalculation();
      await formulaEngine?.onCalculationResultApplied();

      // Recien despues de cargar los datos de la solicitud: esa carga no es
      // un cambio de Riesgo y no debe marcar la planilla como sin guardar.
      const univerAPI = univerApiRef.current;
      if (puedeGuardar && univerAPI && !cambiosListenerRef.current) {
        cambiosListenerRef.current = univerAPI.addEvent(
          univerAPI.Event.SheetValueChanged,
          () => setHayCambios(true),
        );
      }
    } catch (error) {
      setHydrationError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudieron cargar los datos de la solicitud.",
      );
    } finally {
      setIsHydrating(false);
    }
  }

  async function guardar() {
    const workbook = workbookRef.current;

    if (!workbook || source.kind !== "embedded") {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const guardada = await guardarEvaluacionRiesgo(source.solicitudId, {
        nivelRiesgo: leerNivelRiesgo(workbook),
        snapshot: workbook.save(),
      });
      setEvaluacionGuardada(guardada);
      setHayCambios(false);
    } catch (error) {
      setSaveError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo guardar la evaluación.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (source.kind !== "embedded" || isLoading || errorMessage) {
      return;
    }

    void hydrate(() => getCalculadoraMutualDatosByCoreId(source.solicitudId));
    // Solo se auto-hidrata una vez, cuando la planilla termina de cargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, errorMessage, source.kind]);

  return (
    <div className={`flex flex-col ${className ?? "h-[calc(100vh-4rem)]"}`}>
      {source.kind === "standalone" ? (
        <header className="flex items-start justify-between gap-4 border-b border-border bg-surface px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Calculadora Mutual
            </h1>
            <p className="text-sm text-foreground-secondary">
              Editable localmente. El archivo original sigue disponible para
              descargar si alguna hoja no se visualiza bien.
            </p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-foreground-secondary"
                htmlFor="calculadora-mutual-solicitud-oid"
              >
                Nro. Solicitud (Oid)
              </label>
              <Input
                disabled={isLoading || isHydrating}
                id="calculadora-mutual-solicitud-oid"
                onChange={(event) => setSolicitudOid(event.target.value)}
                placeholder="Ej: 220844"
                value={solicitudOid}
              />
            </div>
            <Button
              disabled={isLoading || isHydrating || !solicitudOid.trim()}
              onClick={() => {
                const trimmedOid = solicitudOid.trim();

                if (trimmedOid) {
                  void hydrate(() => getCalculadoraMutualDatos(trimmedOid));
                }
              }}
              size="sm"
            >
              {isHydrating ? "Cargando datos..." : "Cargar datos"}
            </Button>

            {downloadUrl ? (
              <Button asChild size="sm" variant="outline">
                <a download="CALCULADORA MUTUAL.xlsx" href={downloadUrl}>
                  Descargar Excel original
                </a>
              </Button>
            ) : null}
          </div>
        </header>
      ) : null}

      {source.kind === "embedded" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
          <p className="text-sm text-foreground-secondary">
            {evaluacionGuardada
              ? formatGuardada(evaluacionGuardada)
              : "Todavía no se guardó una evaluación para esta solicitud."}
            {evaluacionGuardada?.nivelRiesgo ? (
              <span className="ml-2 font-medium text-foreground">
                Nivel de riesgo: {evaluacionGuardada.nivelRiesgo}
              </span>
            ) : null}
            {hayCambios ? (
              <span className="ml-2 font-medium text-amber-800">
                Hay cambios sin guardar
              </span>
            ) : null}
          </p>

          {puedeGuardar ? (
            <Button
              // Apagado (naranja al 50%) hasta que haya algo para guardar.
              disabled={
                !hayCambios ||
                isLoading ||
                isHydrating ||
                isSaving ||
                !!errorMessage
              }
              onClick={() => void guardar()}
              size="sm"
            >
              {isSaving ? "Guardando..." : "Guardar evaluación"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {saveError ? (
        <p className="px-4 py-1.5 text-sm text-destructive">{saveError}</p>
      ) : null}

      {errorMessage ? (
        <p className="px-4 py-1.5 text-sm text-destructive">{errorMessage}</p>
      ) : null}

      {hydrationError ? (
        <p className="px-4 py-1.5 text-sm text-destructive">{hydrationError}</p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {isLoading && !errorMessage ? (
          <div className="absolute inset-0 z-10">
            <SolicitudesContentLoader label="Cargando calculadora..." />
          </div>
        ) : null}

        {!isLoading && source.kind === "embedded" && isHydrating ? (
          <div className="absolute inset-0 z-10">
            <SolicitudesContentLoader label="Cargando datos de la solicitud..." />
          </div>
        ) : null}

        <div
          className="calculadora-riesgo-univer h-full bg-[#f3f6fb]"
          ref={containerRef}
        />
      </div>
    </div>
  );
}
