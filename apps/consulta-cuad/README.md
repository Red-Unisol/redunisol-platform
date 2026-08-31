# Consulta CUAD

Consulta masiva de CUAD Santa Fe para una lista propia de socios. La entrada
es un Excel (`.xlsx` o `.xlsm`) o JSON con CUILes; la aplicacion no consulta
Vimarx.

El login abre CUAD en un navegador visible. El operador resuelve el captcha
una vez y la aplicacion conserva ese contexto para consultar y renovar la
sesion cuando vence. Nunca se guardan usuarios, contrasenas ni cookies.

## Instalacion

Desde `apps/consulta-cuad`:

```powershell
python -m pip install -e .
playwright install chromium
```

Configura `CUAD_USUARIO`, `CUAD_PASSWORD` y `MISTRAL_API_KEY` en la sesion de
PowerShell. Para resolver siempre el captcha a mano, la clave de Mistral no se
usa:

```powershell
python -m consulta_cuad --probar-login --login-manual
```

## Archivo de socios

El Excel debe tener una fila de encabezados y una columna `CUIL` o `CUIT`.
Tambien puede indicarse otra columna con `--columna`.

| CUIL | Nombre |
| --- | --- |
| 20123456789 | Nombre del socio |

Tambien acepta un JSON con una lista de CUILes:

```json
["20123456789", "27234567890"]
```

## Consultar

Primero conviene probar un lote pequeno. `--nueva` inicia el archivo de salida
desde cero; sin esa opcion el mismo comando reanuda lo pendiente.

```powershell
python -m consulta_cuad --cuiles "C:\ruta\a\socios.xlsx" --login-manual --limite 30 --etiqueta socios --nueva
```

La corrida completa, incluyendo movimientos:

```powershell
python -m consulta_cuad --cuiles "C:\ruta\a\socios.xlsx" --login-manual --etiqueta socios
```

`--solo-cupo` evita descargar movimientos: guarda empleado y totales, incluido
el cupo, y termina antes. La demora se ajusta con `--demora`, `--pausa-cada` y
`--pausa-larga`.

## Salida y reanudacion

Para una etiqueta `socios`, se crean estos archivos locales, ignorados por Git:

```text
corridas/AAAA-MM/cuiles_archivo_socios.json
corridas/AAAA-MM/resultados_socios.ndjson
```

El NDJSON tiene una linea por CUIL con empleado, totales y movimientos. Es el
registro completo y el estado de reanudacion: los CUILes resueltos no se
repiten al ejecutar otra vez el mismo comando.

## Exportar Excel

Los exportadores generan un `.xlsx` junto al NDJSON y no vuelven a consultar
CUAD:

```powershell
python -m consulta_cuad.exportar --tipo totales corridas/AAAA-MM/resultados_socios.ndjson
python -m consulta_cuad.exportar --tipo movimientos corridas/AAAA-MM/resultados_socios.ndjson
```

Luego de instalar el paquete tambien se puede usar `consulta-cuad-exportar`.
Si se omite el archivo, se exporta el NDJSON mas reciente de `corridas/`.
