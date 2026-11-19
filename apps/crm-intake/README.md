# Captura y normalización de Gestión CRM

Borrador independiente para instalar en el dedicado en modo inactivo. La interfaz del borrador instalado sólo expone estado sobre un socket Unix privado. La API de captura queda cerrada. La instalación no abre puertos TCP, no configura credenciales de Bitrix, Edna ni Kestra y no crea una base operativa.

## Contrato de captura y normalización

- **Captura** recibe canal, cuenta o sitio (source_scope), ID estable del envío (source_id), familia del adaptador (form_version) y fecha de la declaración con offset (declared_at). Guarda el texto JSON exacto en original_body, su representación JSONB en original_payload, y los metadatos recibidos en source_metadata. El servicio registra su propia fecha de recepción. El documento, los metadatos y la definición admiten hasta 256 KiB cada uno, con un máximo de 32 niveles. Un documento ambiguo con claves repetidas o inválido se rechaza explícitamente.
- **Formulario exacto.** form contiene id, revision y la definición publicada archivada como objeto JSON. La clave reúne canal, cuenta, ID y revisión. Una suma comprueba si la misma revisión llegó con una definición diferente. La foto referencia la fila inmutable de esa revisión. El adaptador autenticado deberá aportar la definición exacta y verificar su procedencia al habilitarlo.
- **Confirmación.** ingest usa una conexión PostgreSQL dedicada en autocommit y confirma una transacción con la foto, la referencia de formulario y el trabajo pendiente. Un reintento idéntico devuelve la misma foto. Un reintento con distinto contenido, metadatos o revisión bajo el mismo ID devuelve un conflicto. Se conserva la hora de la primera recepción.
- **Interpretación.** answers_path apunta a los campos declarados dentro del documento original. En Edna puede llegar a una respuesta JSON codificada como texto. El normalizador usa esa ubicación y produce el mismo formato para web-loan-v1, whatsapp-intake-v3 y el histórico whatsapp-grouped-v1. Cada resultado queda vinculado a la foto y a la versión del normalizador.
- **Trabajo independiente.** El worker toma un trabajo pendiente a la vez. PostgreSQL impide que dos workers tomen a la vez el mismo trabajo. Un fallo del normalizador programa otro intento con espera exponencial y jitter, con un máximo de ocho intentos. Una familia aún desconocida o una ruta de respuesta que no se puede interpretar queda en estado bloqueado con motivo. Un trabajo agotado queda visible como fallido. Ambos conservan el original y pueden recibir otro trabajo con una versión nueva del intérprete. Al cambiar de versión, se drena la cola anterior con su worker compatible o se programa expresamente la nueva versión para esas fotos.
- **Historial.** Las fotos, las definiciones archivadas y las interpretaciones son de sólo inserción. PostgreSQL rechaza su edición, borrado o truncado. La migración conserva las filas anteriores con sus campos nuevos desconocidos. La actualización del módulo no activa un reprocesamiento histórico.

El borrador registra la declaración y su contexto. La vinculación con una persona, una prestación y una solicitud corresponde al próximo módulo. Un CUIL que pasa el dígito de control valida el formato. La selección de datos con vigencia de seis meses corresponde a la lógica de solicitud.

## Decisiones para la siguiente etapa

| Decisión o atajo que conviene revisar | Qué proponemos hacer |
|---|---|
| Reutilizar respuestas de WhatsApp sólo cuando el reparto terminó de sincronizarse. Esto obliga a repetir formularios válidos. | Validar y conservar la declaración en el momento en que se comprueban origen e identidad. El estado comercial se registra por su cuenta. |
| Usar la última edición de Bitrix al recuperar formularios históricos. Una conversión o asignación podría cambiar esa fecha. | Usar la fecha del envío original. Para históricos, acreditar formulario, fecha y vínculo antes de incorporarlos por lote. |
| Usar una categoría laboral como si resumiera todas las prestaciones de la persona. | Mantener tipo de prestación, organismo y banco separados. Conservar las posibilidades de categorías agrupadas y pedir aclaración cuando cambie la decisión. |
| Interpretar todos los campos del callback. WhatsApp también incluye campos de ramas que la persona no vio. | Preservar la evidencia original y seleccionar sólo los campos de la versión y rama que respondió la persona. |
| Descartar el banco porque Bitrix lo devuelve como lista, incluso si tenía una sola opción. | Normalizar una opción inequívoca. Mantener alternativas cuando haya varios bancos posibles. |
| Tomar el responsable inicial de la ficha como prueba de atención humana. | Mantener identidad, atención humana, reparto y hechos declarados como comprobaciones independientes. |

Antes del primer ingreso real hay que definir cómo obtiene cada adaptador autenticado la definición publicada de su formulario y quién puede acceder a los originales sensibles y por cuánto tiempo. También queda por incorporar la comparación de perfiles en el tiempo, la selección de la prestación específica y las aclaraciones por campo. La versión intake-3 amplía la interpretación web con las opciones verificadas del catálogo de Kestra. Los datos históricos siguen referenciando su versión. Se programa expresamente una nueva interpretación si se necesita actualizar un caso. Los códigos ajenos al catálogo quedan visibles como sin equivalencia.

Se eligió Python para este borrador aislado porque ya es el lenguaje del procesamiento de formularios en Kestra. El contrato PostgreSQL mantiene el diseño de datos previsto. La integración de la coordinación con Laravel se puede decidir delante de este contrato, una vez comparados resultados y reutilización real.

## Precalificación comercial en observación

El evaluador recibe una interpretación versionada, su referencia estable y un instante con zona horaria. El resultado identifica la versión exacta del normalizador, el adaptador y el SHA-256 de las reglas. Usa el código de Kestra incluido desde el mismo commit, con sus vigencias en hora argentina. Distingue calificación comercial, medición web y autorización para ofrecer WhatsApp.

La evaluación de alcance web aplica la política del webhook. Para prospectos CRM hace falta evidencia separada de Haberes CUAD. Una coincidencia tiene prioridad. Una consulta sin evidencia o no disponible queda pendiente. El evaluador recibe la referencia técnica y deja la consulta y el CUIL fuera de su contrato. La variante asistida de Caja Córdoba sin banco y los valores que el normalizador todavía no interpreta requieren completar el contrato antes de la activación.

El observador web corre sin conexiones ni acciones. Consume un JSON minimizado con ventana, fuentes y registros de entrada emparejados con sus resultados históricos.

    python -B -m crm_intake.observe_prequalification /path/to/minimized-observations.json

La comparación distingue cobertura, versiones y diferencias. Las transferencias, cambios de ficha y decisiones de desembolso corresponden a otros módulos.

## Verificación

Desde apps/crm-intake, ejecutar:

    python -B -m crm_intake.sample
    python -B -m unittest discover -s tests -v

La prueba PostgreSQL exige CRM_INTAKE_TEST_DSN apuntando a una base descartable vacía y el driver Psycopg. CI comprueba la captura confirmada en otra conexión, la recuperación del worker, el agotamiento de reintentos y la inmutabilidad de las filas. La prueba del socket privado se ejecuta en Linux.

## Instalación inactiva

Desde un controlador Ansible conforme a infra/ansible/README.md, usar el inventario de producción, limitar a dedicated_prod_01 y pasar crm_intake_revision con el SHA completo de main. El playbook crm-intake-prepare.yml instala el código versionado en /opt/redunisol-crm-intake y ejecuta una normalización y una precalificación sintéticas antes de arrancar el proceso de estado. Los empaquetados Git para el controlador incluyen apps/crm-intake, infra/ansible y los seis archivos de política enumerados por el rol crm_intake. crm-intake-verify.yml comprueba la revisión y que una captura de prueba se rechace con 503.

El servicio redunisol-crm-intake está aislado de la red y el socket /run/redunisol-crm-intake/status.sock es privado. El estado verifica que tanto la captura como el worker estén inactivos. PostgreSQL se prepara en otro paso. Para un ensayo local puede aplicarse schema.sql a una base descartable e iniciar python -m crm_intake.worker con CRM_INTAKE_WORKER_ENABLED=1 y CRM_INTAKE_DATABASE_URL. La unidad del dedicado sólo ejecuta el proceso de estado. Git y Ansible conservan el estado deseado.
