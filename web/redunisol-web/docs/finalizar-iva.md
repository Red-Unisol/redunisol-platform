# Tasas con IVA en Finalizar

## Comportamiento

Las rutas `/finalizar`, `/finalizar.php` y `/finalizar-nvo` enriquecen el préstamo
resuelto por `finSolicitud` con consultas de **solo lectura** a Vimarx. Se utiliza
`NumeroPrestamo` de esa respuesta, nunca un número ni una marca de IVA suministrados
por la URL. No se modifican préstamos, cargos, cuotas ni fórmulas del legacy.

- Préstamo: entidad `F.Module.Cuentas.Prestamos.Prestamo`, filtro por `NroCuenta`,
  campos `NroCuenta;Iif([IVA] > 0, True, False);TasaInicial;MontoADesembolsar;Cuotas`.
  Vimarx devuelve un array o un string JSON que contiene ese array según el
  encabezado Accept; se verificaron y admiten ambos formatos.
- La expresión reproduce el criterio de la fórmula almacenada **Lleva IVA (283)**,
  sin depender de su carga en una sesión ni de nombres/códigos de líneas.
- Si la marca es `false`, se conservan las cuatro tasas originales.
- Si es `true`, TEM = `TasaInicial / 1.21`, TNA = `TEM * 12`,
  TEA = `(1 + TEM)^12 - 1`. Las tasas se mantienen como fracciones hasta
  formatearlas a porcentaje con dos decimales al final.
- CFT: TIR mensual del neto `MontoADesembolsar` y los importes originales
  `CuotaPrestamo.MontoTotal`, anualizada con `(1 + TIR)^12 - 1`.
  Es un método por períodos mensuales, **no XIRR por fechas**.
- Se exigen cuotas 1..N completas, únicas y positivas. Se ordenan por número.
  Se reutiliza la convención del core: descripción exacta `NroCuenta/NroCuota`.
  Se excluyen pagos, desembolsos y cuota 0. El cargo inicial financiado ya está
  reflejado en el neto recibido y en las cuotas: no se agrega otra vez.
- No se utilizan saldos actuales, punitorios posteriores, promedios de tasas de
  líneas ni porcentajes fijos de cargos. Se respeta el redondeo de cada cuota.
- El indicador no revela la alícuota: esta versión usa el **21% acordado**.
  Si se incorporan otras alícuotas, habrá que ampliar el dato fuente.

Pantalla y `eSignature.customVariables` usan los mismos resultados. Se conservan
las claves 5=TNA, 6=TEA, 7=CFT, 8=TEM y los IDs existentes de documentos/flujos.
Para préstamos con IVA se indican TNA/TEA/TEM «sin IVA» y CFT «con IVA».
Con un préstamo resuelto, la pantalla no sustituye tasas faltantes por valores
administrativos generales distintos de los enviados a MetaMap.

## Datos incompletos

Por decisión funcional, un fallo de enriquecimiento **no impide avanzar a MetaMap**.
La pantalla muestra «No disponible» y se envía cadena vacía para la tasa que no
pueda obtenerse. Si se calculan las tasas de interés pero falla el cronograma,
se conservan esas tres tasas y queda vacío únicamente el CFT.
Una marca desconocida no se interpreta como `false`: no se muestran tasas
originales que podrían incluir IVA. No se simula un cálculo exitoso.

Hay hasta dos lecturas adicionales por visita, sin reintentos automáticos,
con conexión limitada a 5 s y cada consulta a 10 s. El número de cuotas está
acotado técnicamente a 1000 y una respuesta truncada no produce un CFT.

## Configuración y despliegue

`FINALIZAR_VIMARX_API_BASE_URL` es la base de EvaluateList para Caja y Solicitudes;
por defecto `https://celesol.dyndns.org:5002`, la fuente documentada y verificada.
Está expuesta en Docker Compose. No requiere nuevas credenciales ni migraciones.
El dev de Solicitudes lee el legacy real; no es un sandbox financiero.
ITS y Fiat conservan su circuito y no ejecutan esta consulta adicional.

La configuración de MetaMap se conserva. En particular, `amejuca-redunisol`
no tiene entrada propia en el catálogo actual y sigue el fallback existente;
no se asignó por suposición el contrato de otra entidad. Antes de una prueba
real de firma hay que confirmar con el responsable el flujo/documento que
corresponde y sus etiquetas. Cambiar `title` en metadata no verifica el texto
fijo de la plantilla ni demuestra el contenido de un PDF firmado.

## Validación antes de publicar

1. Ejecutar Pest sobre `FinalizarIvaRatesTest`, `FinalizarIvaTest` y
   `FinalizarPageTest`; ejecutar `npm run build`.
2. Comparar el préstamo de referencia: TEM 10%, TNA 120%, TEA 213,84%,
   CFT 449,59%, con neto de 1 millón y 12 cuotas (última con redondeo).
3. Verificar un préstamo sin IVA y otro cuyo cronograma no esté disponible.
4. Revisar las tres rutas a 1440 y 390 px; confirmar valores en pantalla y
   metadata, sin iniciar verificación de identidad.
5. Tras autorización de despliegue, abrir el enlace proporcionado en dev y
   comparar su préstamo real. Ese enlace corresponde a **1017071**, no al
   ejemplo **1017049**; no deben esperarse tasas idénticas entre ambos.

El Excel `CALCULO IVA VERSIONES.xlsx` se utilizó como evidencia de cálculo:
cuatro ejemplos RATE comprobados independientemente. Sus propuestas de sustituir
cargos iniciales por nuevas tasas no se aplican como configuración de líneas.

## Resultado de lectura real (22/11/2026)

El servicio PHP implementado, contra EvaluateList real y sin escrituras, obtuvo:

| Préstamo | TEM sin IVA | TNA sin IVA | TEA sin IVA | CFT con IVA |
| --- | ---: | ---: | ---: | ---: |
| 1017049 | 10,00% | 120,00% | 213,84% | 449,59% |
| 1017071 | 10,86% | 130,31% | 244,57% | 339,94% |

Esto valida la lectura y el cálculo; no es una prueba de firma ni del PDF de
MetaMap. No se generaron préstamos ni se modificaron datos o plantillas.
