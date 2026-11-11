# Ingreso orgánico de WhatsApp — tarea 23571

Versión: `2026-11-11-organic-menu-profile-reuse`.
Estado: **implementado en rama, pendiente de integración y despliegue**.
Decisión funcional: Santiago, en esta conversación del 11/11/2026.
Seguimiento: [Bitrix 23571](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23571/).

## Bienvenida

En una sesión orgánica nueva de WhatsApp Ventas se presenta:

> ¡Hola! 👋 Te comunicaste con el sector comercial de Red Unisol.
> Para ayudarte más rápido, contanos: ¿tu consulta es por un préstamo o por otro tema?

Opciones: **Quiero un préstamo** y **Otra consulta**.

Los recurrentes también ven estas opciones. La existencia de datos guardados no
omite la pregunta inicial. Se conserva la atención si una persona ya tomó,
respondió o transfirió explícitamente el chat.

## Decisiones aprobadas

| ID | Condición | Resultado |
|---|---|---|
| ORG-010 | Continuación web con referencia, recibo vigente o declaración de formulario | Mantener la continuidad web y sus comprobaciones. |
| ORG-020 | Atención humana o asignación que deba conservarse | Conservar atención; no enviar una bienvenida ni sobreescribirla. |
| ORG-030 | Nueva sesión orgánica elegible, incluido recurrente sin continuación web vigente | Una bienvenida por sesión nativa comprobada. |
| ORG-040 | Elige Otra consulta | Derivar el chat a Martín Rodríguez, Tincho, usuario 5737, si conserva elegibilidad y sus responsables CRM. |
| ORG-050 | Elige préstamo y tiene datos completos confirmados hace menos de seis meses | Reutilizar esos datos sin enviar el v3. |
| ORG-060 | Además conserva una única gestión comercial abierta con vendedor | Continuar esa gestión y derivar al vendedor vigente; no crear otra negociación. |
| ORG-070 | Datos reutilizables y no hay gestión abierta | Registrar una nueva consulta idempotente y pasar por la evaluación y distribución habituales. |
| ORG-080 | Faltan datos, están vencidos o no se puede identificar de forma suficiente a la persona | Solicitar los datos mediante el Flow v3 existente, cuando no hubo una escritura incierta. |
| ORG-090 | Identidad o asignación contradictorias; varias gestiones; resultado de escritura incierto | Conservar el caso para revisión; no repetir POST ni enviar otro Flow como alternativa a una escritura incierta. |

La antigüedad usa la **fecha original de declaración o confirmación de los datos**.
Editar la ficha CRM, reutilizar un perfil o iniciar otra consulta no renueva ese
plazo. Se usan seis meses calendario, configurables y comprobados en Web y Kestra.
Provincia, situación laboral, origen de haberes cuando corresponda, banco cuando
corresponda y CUIL deben ser completos y compatibles con el v3. El email sigue
siendo opcional. Una selección antigua agrupada Jubilado/Pensionado no establece
la distinción requerida por el v3.

Un teléfono compartido no autoriza elegir entre personas. La reutilización exige
una identidad única y coherente con los contactos y prospectos actuales, una
fuente fechada y una conversación de origen comprobada. No se reutiliza una
aprobación crediticia anterior: la evaluación comercial vigente se vuelve a ejecutar.

## Casos de aceptación

- Un cliente nuevo elige préstamo: recibe un único v3.
- Un recurrente con perfil completo de dos meses elige préstamo: no recibe v3;
  se continúa la gestión abierta o se inicia la nueva evaluación correspondiente.
- Un perfil de siete meses o sin fecha comprobable requiere completar v3.
- Un recurrente elige Otra consulta: el destino es Tincho, con las protecciones
  de atención humana y responsables CRM.
- Una respuesta duplicada, antigua o de otra sesión no produce otra derivación.
- Un timeout después de enviar no habilita repetir el mensaje o la transferencia.

El resto de los buckets, criterios crediticios y flujos de la tarea 23571 conserva
sus reglas independientes.
