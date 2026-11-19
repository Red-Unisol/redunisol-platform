# Captura y normalización de Gestión CRM

Borrador independiente para instalar en el dedicado en modo inactivo. La interfaz del borrador instalado sólo expone estado sobre un socket Unix privado. La API de captura queda cerrada. La instalación no abre puertos TCP, no configura credenciales de Bitrix, Edna ni Kestra y no crea una base operativa.

## Alcance de la primera versión

- **Captura** acepta un objeto JSON del adaptador con channel, source_scope, source_id, form_version, declared_at y payload. Los dos primeros identifican el canal y su cuenta o sitio. source_id es el identificador estable del envío del proveedor. declared_at incluye zona horaria y conserva la fecha original. received_at lo fija el servicio. Se guardan los nombres y valores del JSON, incluida la información desconocida. Los límites iniciales son 32 KiB y 12 niveles.
- **Normalización** produce el mismo modelo para web-loan-v1 y whatsapp-intake-v3. whatsapp-grouped-v1 representa formularios históricos con las opciones agrupadas. Cada campo indica el estado de la interpretación y qué respuestas lo respaldan. El original y cada interpretación se guardan por separado en PostgreSQL. Un formulario desconocido conserva su original y deja explícita la falta de interpretación.
- **Persistencia** se prueba contra un PostgreSQL descartable. La combinación de canal, cuenta y envío evita duplicar una presentación. Reutilizar el mismo identificador con contenido diferente da un conflicto. Una interpretación con una versión nueva puede agregarse sobre la misma declaración. Las automatizaciones comerciales vigentes no leen este borrador.

El registro de una declaración diferencia campos respondidos de datos como el teléfono usado para entregarla. El borrador preserva la entrada y el estado de cada dato, pero deja la vinculación de una persona, sus prestaciones y su solicitud al próximo módulo. Un CUIL que pasa el dígito de control sólo valida el formato. Los datos producidos a partir de etiquetas antiguas conservan su procedencia. El saldo de seis meses y los campos necesarios para cada decisión se aplicarán al seleccionar datos para una solicitud.

## Decisiones para la siguiente etapa

| Decisión o atajo que conviene revisar | Qué proponemos hacer |
|---|---|
| Reutilizar respuestas de WhatsApp sólo cuando el reparto terminó de sincronizarse. Esto obliga a repetir formularios válidos. | Validar y conservar la declaración en el momento en que se comprueban origen e identidad. El estado comercial se registra por su cuenta. |
| Usar la última edición de Bitrix al recuperar formularios históricos. Una conversión o asignación podría cambiar esa fecha. | Usar la fecha del envío original. Para históricos, acreditar formulario, fecha y vínculo antes de incorporarlos por lote. |
| Usar una categoría laboral como si resumiera todas las prestaciones de la persona. | Mantener tipo de prestación, organismo y banco separados. Conservar las posibilidades de categorías agrupadas y pedir aclaración cuando cambie la decisión. |
| Interpretar todos los campos del callback. WhatsApp también incluye campos de ramas que la persona no vio. | Preservar la evidencia original y seleccionar sólo los campos de la versión y rama que respondió la persona. |
| Descartar el banco porque Bitrix lo devuelve como lista, incluso si tenía una sola opción. | Normalizar una opción inequívoca. Mantener alternativas cuando haya varios bancos posibles. |
| Tomar el responsable inicial de la ficha como prueba de atención humana. | Mantener identidad, atención humana, reparto y hechos declarados como comprobaciones independientes. |

Antes del primer ingreso real hay que fijar el registro de versiones de formulario por cuenta, la autenticación de cada adaptador y el acceso y la retención de originales sensibles. También queda por incorporar la comparación de perfiles en el tiempo, la selección de la prestación específica y las aclaraciones por campo. El primer catálogo cubre los valores conocidos de estos formularios. Los nuevos códigos quedan visibles como sin equivalencia hasta que se versionen sus reglas.

Se eligió Python para este borrador aislado porque ya es el lenguaje del procesamiento de formularios en Kestra. El contrato PostgreSQL mantiene el diseño de datos previsto. La integración de la coordinación con Laravel se puede decidir delante de este contrato, una vez comparados resultados y reutilización real.

## Verificación

Desde apps/crm-intake, ejecutar:

    python -B -m crm_intake.sample
    python -B -m unittest discover -s tests -v

La prueba PostgreSQL exige CRM_INTAKE_TEST_DSN apuntando a una base descartable vacía y el driver Psycopg. CI ensaya preservación del original, reintentos y una segunda versión de interpretación. La prueba del socket privado se ejecuta en Linux.

## Instalación inactiva

Desde un controlador Ansible conforme a infra/ansible/README.md, usar el inventario de producción, limitar a dedicated_prod_01 y pasar crm_intake_revision con el SHA completo de main. El playbook crm-intake-prepare.yml instala el código versionado en /opt/redunisol-crm-intake y ejecuta una normalización sintética antes de arrancar el proceso de estado. crm-intake-verify.yml comprueba la revisión y que una captura de prueba se rechace con 503.

El servicio redunisol-crm-intake está aislado de la red y el socket /run/redunisol-crm-intake/status.sock es privado. PostgreSQL se prepara en otro paso. El único efecto de este despliegue es instalar y servir el estado de la versión inactiva. Git y Ansible conservan el estado deseado.
