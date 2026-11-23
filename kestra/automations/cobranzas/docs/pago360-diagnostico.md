# Diagnóstico de una operación, sin imputar

Este comando compara el importe informado por el operador con la cuota actual
en Vimarx. No consulta Pago360, no confirma la operación del portal y no llama
al motor financiero, a reservas, callbacks ni endpoints de cobro. Su único
endpoint es `POST /api/Empresa/EvaluateList`, una consulta de solo lectura.

Se mantiene el estado de los dos flows y disparadores: **deshabilitados**.
No hace falta ejecutarlos ni cambiar su YAML desde la UI para este diagnóstico.

## Ejecución local

Usar el entorno Python del repositorio con las dependencias de
`kestra/tools/requirements.txt`. La URL debe ser un origen HTTPS sin credenciales
ni parámetros. Se reutiliza `VIMARX_EVAL_BASE_URL`; opcionalmente se reutiliza
`VIMARX_BEARER_TOKEN` cuando la API correspondiente requiera autenticación.
TLS se verifica; no se siguen redirecciones ni se reintenta una petición.

Con los valores del caso previamente identificado, desde la raíz de Platform:

```bash
export VIMARX_EVAL_BASE_URL=https://celesol.dyndns.org:5002
PYTHONPATH=kestra/automations/cobranzas/files python -m pago360.diagnostic \
  --provider-id "$ID_PAGO360" \
  --loan-number "$NUMERO_PRESTAMO" \
  --installment-number "$NUMERO_CUOTA" \
  --amount "$IMPORTE_INFORMADO"
```

El importe debe usar punto decimal, sin separadores de miles, y ser exacto en
centavos. El número del proveedor **no es el UUID de la operación del portal**
ni se utiliza para disparar el flow. Se valida cada identificador antes de
construir el filtro y se exige una única cuota del plan.

## Interpretación

- `DIAGNOSTIC_ONLY` y código de salida 0: se pudo leer y comparar la cuota.
  No significa pago recibido, imputación realizada ni autorización para cobrar.
- `UNAVAILABLE` y código de salida 1: consulta inválida, fallida o ambigua.
  El mensaje no incluye tokens, cuerpos de respuesta ni detalles de conexión.
- `AMOUNT_DIFFERS_FROM_CURRENT_TOTAL`: el importe informado no coincide con
  `SaldoCuotaConPunitorios`. No se reemplaza por el saldo base ni se cambia
  fecha, importe o criterio de punitorios para hacerlo coincidir.
- `PAYMENT_STATUS_REQUIRES_REVIEW`: hay saldo base cero o fecha de cobro;
  eso no prueba que el cobro corresponda a este cupón.
- `write_enabled=false` y `provider_payment_verified=false` siempre.
  `unverified` enumera las etapas que este comando no comprueba.

La salida contiene solo identificación financiera y saldos, no nombre,
documento ni contacto del socio. Conservar los resultados reales fuera de Git.

## Para completar el caso identificado

1. En el portal, recuperar el UUID interno usando la referencia Pago360.
2. Verificar estado, importe efectivamente cobrado, ambiente, referencia y
   fecha efectiva mediante la API autenticada de Pago360. La tabla del portal
   y un cupón emitido no sustituyen esa comprobación.
3. Leer el snapshot original de cuotas y la evidencia del pendiente/outbox.
   Una operación histórica sin snapshot suficiente queda en revisión; no se
   reconstruye silenciosamente con la deuda actual.
4. Consultar en Kestra las ejecuciones y el ID de la operación recibida. Una
   respuesta 401/403 indica acceso pendiente; no equivale a cero ejecuciones.
5. Revisar cualquier diferencia de deuda antes de considerar una imputación.
   El alcance vigente no incorpora nuevas reglas de parciales ni punitorios.

El pago informado por el usuario se comprobó contra Vimarx el 23/11/2026,
solo lectura. El importe coincidía con el saldo base pero no con el total
con punitorios; no había fecha de cobro. Su informe detallado queda como
artefacto local, sin datos del socio en el repositorio.

La integración no queda terminada con este diagnóstico: faltan los adaptadores
productivos y el acceso al portal/Kestra para completar esas comprobaciones.

## Pruebas

```bash
python -m unittest discover -s kestra/automations/cobranzas/tests -p 'test_*.py' -v
python kestra/tools/validate_kestra.py
python kestra/tools/deploy_kestra.py --environment dev --domain cobranzas --dry-run
python kestra/tools/deploy_kestra.py --environment prod --domain cobranzas --dry-run
```

Los dobles verifican lectura única, formato directo/doblemente codificado,
importes exactos, identidad ambigua, errores sin filtraciones, ausencia de
reintentos y que una coincidencia nunca autorice una escritura. Las pruebas
existentes verifican además que ambos flujos y disparadores sigan inactivos.
