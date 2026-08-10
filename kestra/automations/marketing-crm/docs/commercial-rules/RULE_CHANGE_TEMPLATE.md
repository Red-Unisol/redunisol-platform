# Plantilla de Cambio de Regla Comercial

Copiar esta plantilla para proponer una regla nueva o modificar una existente. Las
respuestas deben expresarse con conceptos del negocio; Tecnología completa el mapeo de
campos e IDs después de la aprobación funcional.

## Identificación

- **Título del cambio:**
- **Provincia:**
- **Proceso:** Precalificación / Clasificación de negociación / Distribución
- **Regla existente afectada:**
- **Business owner responsable:**
- **Fecha requerida:**

## Decisión en una frase

> Dado __________, cuando __________, entonces __________.

## Condiciones

| Dato | Operador | Valor |
|---|---|---|
| Provincia | Es | |
| Situación laboral | Es / Está en | |
| Es socio | Es | Sí / No / Desconocido / No aplica |
| Créditos activos | Es / Mayor que | |
| Banco de cobro | Es / Está en | |
| Entidades BCRA | Cantidad / Situación máxima | |
| Condición adicional | | |

No dejar celdas ambiguas. Escribir `Cualquiera`, `Desconocido` o `No aplica` cuando
corresponda.

## Resultado esperado

- **Decisión:** Aprobado / Rechazo BCRA / Revisión manual
- **Etapa de negociación:**
- **Línea:**
- **Motivo visible o auditable:**
- **¿Debe cerrarse automáticamente?:**

La asignación de responsable se define únicamente si el proceso elegido es
Distribución.

## Prioridad y conflictos

- **¿Qué regla debe evaluarse antes que esta?:**
- **¿Qué regla debe evaluarse después?:**
- **Si faltan datos, el resultado debe ser:**
- **Si ninguna regla coincide, el resultado debe ser:**

## Ejemplos obligatorios

### Caso que debe aprobar

- Dado:
- Cuando:
- Entonces:

### Caso que debe rechazar

- Dado:
- Cuando:
- Entonces:

### Caso que debe quedar manual

- Dado:
- Cuando:
- Entonces:

### Casos de borde

Incluir valores exactamente en el límite y apenas fuera de él. Por ejemplo, si el
máximo es cinco entidades, documentar casos con cinco y con seis.

## Aprobación

- **Aprobado por:**
- **Fecha:**
- **Versión documental:**
- **Observaciones:**

## Implementación — completa Tecnología

- **Campos y fuentes:**
- **Identificador de regla:**
- **Pruebas automatizadas:**
- **Pull request:**
- **Fecha de deploy:**
- **Auditoría posterior al deploy:**
