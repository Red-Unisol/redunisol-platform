# Auditoria de Leads en Bitrix24

- fecha de generacion: `2026-03-30 10:25:29`
- ventana analizada: `2026-03-01` a `2026-03-30` inclusive
- leads analizados: `6408`
- campos totales en `crm.lead.fields`: `119`
- campos tipo desplegable (`enumeration` o `crm_status`): `26`
- campos con al menos un valor en la ventana: `51`
- campos sin uso en la ventana: `68`

## Campos usados por la automatizacion de formulario

- `CONTACT_ID` - Contacto
- `EMAIL` - E-mail
- `NAME` - Nombre
- `PHONE` - Teléfono
- `STATUS_ID` - Etapa
- `TITLE` - Título de prospecto
- `UF_CRM_1693840106704` - CUIL
- `UF_CRM_1714071903` - Sit Laboral
- `UF_CRM_1722365051` - origenFormulario
- `UF_CRM_64E65D2B2136C` - ProvinciaContacto
- `UF_CRM_LEAD_1711458190312` - Banco de Cobro
- `UF_CRM_REJECTION_REASON` - Motivo Rechazo

## Campos custom efectivamente usados en la ventana

- `UF_CRM_1690295643293` - Enviado: `6408` leads
- `UF_CRM_1716466733` - Situacion Laboral: `6408` leads
- `UF_CRM_1716466790` - Banco de Cobro Cliente: `6408` leads
- `UF_CRM_1716466829` - Provincia de Contacto: `6408` leads
- `UF_CRM_LEAD_1711458190312` - Banco de Cobro: `6408` leads
- `UF_CRM_LEAD_1713892502679` - Recomendación: `6408` leads
- `UF_CRM_LEAD_1713892573319` - ¿Recomendarías a alguien que invierta con nosotros?: `6408` leads
- `UF_CRM_LEAD_1744204643309` - ¿En qué tipo de inversiones has participado?: `6408` leads
- `UF_CRM_1722365051` - origenFormulario: `6278` leads
- `UF_CRM_1714071903` - Sit Laboral: `6277` leads
- `UF_CRM_1693840106704` - CUIL: `6271` leads
- `UF_CRM_64E65D2B2136C` - ProvinciaContacto: `6240` leads
- `UF_CRM_LEAD_1711392404332` - DNI: `288` leads
- `UF_CRM_64F9E8DA4DD9B` - recibo: `82` leads
- `UF_CRM_LEAD_1706273705244` - Banco de Cobro: `1` leads

## Inventario completo de campos

| Campo API | Label | Tipo | Custom | Usado en flujo | Leads con valor | Distintos |
| --- | --- | --- | --- | --- | ---: | ---: |
| `ADDRESS` | Dirección | string | no | no | 0 | 0 |
| `ADDRESS_2` | Dirección (línea 2) | string | no | no | 0 | 0 |
| `ADDRESS_CITY` | Ciudad | string | no | no | 0 | 0 |
| `ADDRESS_COUNTRY` | País | string | no | no | 0 | 0 |
| `ADDRESS_COUNTRY_CODE` | Código de País | string | no | no | 0 | 0 |
| `ADDRESS_LOC_ADDR_ID` | Location address ID | integer | no | no | 0 | 0 |
| `ADDRESS_POSTAL_CODE` | Código Postal | string | no | no | 0 | 0 |
| `ADDRESS_PROVINCE` | Estado / Provincia | string | no | no | 0 | 0 |
| `ADDRESS_REGION` | Región | string | no | no | 0 | 0 |
| `ASSIGNED_BY_ID` | Persona responsable | user | no | no | 6408 | 17 |
| `BIRTHDATE` | Fecha de nacimiento | date | no | no | 0 | 0 |
| `COMMENTS` | Comentario | string | no | no | 6 | 3 |
| `COMPANY_ID` | Compañía | crm_company | no | no | 0 | 0 |
| `COMPANY_TITLE` | Nombre de la compañía | string | no | no | 6 | 1 |
| `CONTACT_ID` | Contacto | crm_contact | no | si | 4343 | 3652 |
| `CONTACT_IDS` | CONTACT_IDS | crm_contact | no | no | 0 | 0 |
| `CREATED_BY_ID` | Creado por | user | no | no | 6408 | 9 |
| `CURRENCY_ID` | Moneda | crm_currency | no | no | 6408 | 1 |
| `DATE_CLOSED` | Completado el | datetime | no | no | 6101 | 30 |
| `DATE_CREATE` | Creado el | datetime | no | no | 6408 | 6393 |
| `DATE_MODIFY` | Modificado el | datetime | no | no | 6408 | 6393 |
| `EMAIL` | E-mail | crm_multifield | no | si | 6278 | 6277 |
| `HAS_EMAIL` | Tiene correo electrónico | char | no | no | 6408 | 2 |
| `HAS_IMOL` | Tiene canal abierto | char | no | no | 6408 | 2 |
| `HAS_PHONE` | Tiene teléfono | char | no | no | 6408 | 2 |
| `HONORIFIC` | Saludo | crm_status | no | no | 0 | 0 |
| `ID` | ID | integer | no | no | 6408 | 6407 |
| `IM` | Messenger | crm_multifield | no | no | 1289 | 1289 |
| `IS_MANUAL_OPPORTUNITY` | IS_MANUAL_OPPORTUNITY | char | no | no | 6408 | 1 |
| `IS_RETURN_CUSTOMER` | Prospecto repetido | char | no | no | 6408 | 2 |
| `LAST_ACTIVITY_BY` | LAST_ACTIVITY_BY | user | no | no | 6408 | 9 |
| `LAST_ACTIVITY_TIME` | LAST_ACTIVITY_TIME | datetime | no | no | 6408 | 6394 |
| `LAST_COMMUNICATION_TIME` | LAST_COMMUNICATION_TIME | string | no | no | 4736 | 4727 |
| `LAST_NAME` | Apellido | string | no | no | 696 | 445 |
| `LINK` | LINK | crm_multifield | no | no | 1248 | 1248 |
| `MODIFY_BY_ID` | Modificado por | user | no | no | 6408 | 23 |
| `MOVED_BY_ID` | MOVED_BY_ID | user | no | no | 6408 | 78 |
| `MOVED_TIME` | MOVED_TIME | datetime | no | no | 6408 | 6394 |
| `NAME` | Nombre | string | no | si | 6404 | 5552 |
| `OPENED` | Disponible para todo el mundo | char | no | no | 6408 | 1 |
| `OPPORTUNITY` | Total | double | no | no | 6408 | 1 |
| `ORIGINATOR_ID` | Fuente externa | string | no | no | 6 | 1 |
| `ORIGIN_ID` | ID del elemento en la fuente de datos | string | no | no | 6 | 2 |
| `PHONE` | Teléfono | crm_multifield | no | si | 6375 | 6374 |
| `POST` | Cargo | string | no | no | 0 | 0 |
| `SECOND_NAME` | Segundo nombre | string | no | no | 0 | 0 |
| `SOURCE_DESCRIPTION` | Información de origen | string | no | no | 0 | 0 |
| `SOURCE_ID` | Origen | crm_status | no | no | 6408 | 6 |
| `STATUS_DESCRIPTION` | Más información sobre esta etapa | string | no | no | 0 | 0 |
| `STATUS_ID` | Etapa | crm_status | no | si | 6408 | 19 |
| `STATUS_SEMANTIC_ID` | Detalles de estado | string | no | no | 6408 | 3 |
| `TITLE` | Título de prospecto | string | no | si | 6408 | 5528 |
| `UTM_CAMPAIGN` | UTM de campaña publicitaria | string | no | no | 0 | 0 |
| `UTM_CONTENT` | Contenido de campaña | string | no | no | 0 | 0 |
| `UTM_MEDIUM` | Medio | string | no | no | 0 | 0 |
| `UTM_SOURCE` | Fuente de campaña | string | no | no | 0 | 0 |
| `UTM_TERM` | Término de búsqueda de campaña | string | no | no | 0 | 0 |
| `WEB` | Sitio Web | crm_multifield | no | no | 7 | 7 |
| `UF_CRM_1690295643293` | Enviado | boolean | si | no | 6408 | 1 |
| `UF_CRM_1693840106704` | CUIL | double | si | si | 6271 | 5098 |
| `UF_CRM_1704896253508` | Linea | string | si | no | 0 | 0 |
| `UF_CRM_1714071903` | Sit Laboral | enumeration | si | si | 6277 | 13 |
| `UF_CRM_1715713060` | Nombre Prospecto | string | si | no | 0 | 0 |
| `UF_CRM_1715713079` | Apellido Prospecto | string | si | no | 0 | 0 |
| `UF_CRM_1716466733` | Situacion Laboral | string | si | no | 6408 | 1 |
| `UF_CRM_1716466790` | Banco de Cobro Cliente | string | si | no | 6408 | 1 |
| `UF_CRM_1716466829` | Provincia de Contacto | string | si | no | 6408 | 1 |
| `UF_CRM_1716907209` | Origen | string | si | no | 0 | 0 |
| `UF_CRM_1718209943683` | Nueva lista | enumeration | si | no | 0 | 0 |
| `UF_CRM_1718209975147` | Campo Test | enumeration | si | no | 0 | 0 |
| `UF_CRM_1722365051` | origenFormulario | enumeration | si | si | 6278 | 7 |
| `UF_CRM_1725370937` | Tipo Campaña Desplegable Prospecto | enumeration | si | no | 0 | 0 |
| `UF_CRM_1728998183` | YaSoySocio | enumeration | si | no | 0 | 0 |
| `UF_CRM_1730295104` | nombreReferente | string | si | no | 0 | 0 |
| `UF_CRM_1730295133` | contactoReferente | double | si | no | 0 | 0 |
| `UF_CRM_1730905774354` | socioReferente | double | si | no | 0 | 0 |
| `UF_CRM_64E65D2B2136C` | ProvinciaContacto | enumeration | si | si | 6240 | 24 |
| `UF_CRM_64F9E8DA4DD9B` | recibo | file | si | no | 82 | 82 |
| `UF_CRM_67F67D69DFE9C` | Formato del evento | enumeration | si | no | 0 | 0 |
| `UF_CRM_AVITO_WZ` | Avito_WZ | string | si | no | 0 | 0 |
| `UF_CRM_INSTAGRAM_WZ` | Instagram_WZ | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1682354378894` | Información Córdoba | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1682363576115` | cba | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1682363594356` | neuquen | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1682363609836` | TIPO DE CAMPAÑA (NO SE USA) | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1686666713875` | Ocupación | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1686669327915` | Ocupación | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1706273705244` | Banco de Cobro | string | si | no | 1 | 1 |
| `UF_CRM_LEAD_1706733987482` | Movimientos bancarios | file | si | no | 0 | 0 |
| `UF_CRM_LEAD_1706740387059` | E-mail | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1711392404332` | DNI | string | si | no | 288 | 228 |
| `UF_CRM_LEAD_1711458190312` | Banco de Cobro | enumeration | si | si | 6408 | 48 |
| `UF_CRM_LEAD_1713890924023` | Satisfacción | double | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713891027110` | 1 | double | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713891380847` | Claridad de información | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713891450015` | ¿Invertirías nuevamente con nosotros? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713891616703` | ¿Cómo consideras que fue la atención recibida? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713892443039` | ¿Qué tan clara fue la información proporcionada? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713892502679` | Recomendación | boolean | si | no | 6408 | 1 |
| `UF_CRM_LEAD_1713892573319` | ¿Recomendarías a alguien que invierta con nosotros? | boolean | si | no | 6408 | 1 |
| `UF_CRM_LEAD_1713892664047` | ¿Recomendarías a alguien que invierta con nosotros? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1713892735279` | ¿Qué tan satisfecho estás operando con nosotros? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1744204544142` | ¿Cuál es tu nivel de conocimiento sobre inversiones? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1744204643309` | ¿En qué tipo de inversiones has participado? | enumeration | si | no | 6408 | 1 |
| `UF_CRM_LEAD_1744204756446` | ¿Cuál es tu horizonte de inversión? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1744204826685` | ¿Qué monto estimado te gustaría invertir? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1745945463707` | ¿Cuál es tu nivel de conocimiento sobre inversiones? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1745945592698` | ¿Cómo preferís recibir más información? | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1745946540876` | Entidad | string | si | no | 0 | 0 |
| `UF_CRM_LEAD_1750865276469` | ¿Cómo te enteraste del webinar?  | enumeration | si | no | 0 | 0 |
| `UF_CRM_LEAD_1750865501620` | ¿Conocés el producto Ahorro Mutual a Término de Celesol?   | enumeration | si | no | 0 | 0 |
| `UF_CRM_MAXID_WZ` | MaxId_WZ | string | si | no | 0 | 0 |
| `UF_CRM_MAXUSERNAME_WZ` | MaxUsername_WZ | string | si | no | 0 | 0 |
| `UF_CRM_REJECTION_REASON` | Motivo Rechazo | enumeration | si | si | 0 | 0 |
| `UF_CRM_TELEGRAMID_WZ` | TelegramId_WZ | string | si | no | 0 | 0 |
| `UF_CRM_TELEGRAMUSERNAME_WZ` | TelegramUsername_WZ | string | si | no | 0 | 0 |
| `UF_CRM_VK_WZ` | VK_WZ | string | si | no | 0 | 0 |
| `UF_CRM_WHATSAPPLID_WZ` | WhatsappLid_WZ | string | si | no | 0 | 0 |
| `UF_CRM_WHATSAPPUSERNAME_WZ` | WhatsappUsername_WZ | string | si | no | 0 | 0 |

## Desplegables y valores posibles

### `HONORIFIC` - Saludo

- tipo: `crm_status`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `HNR_LA_1`: Sr. | usados: 0
- `HNR_LA_2`: Sra. | usados: 0

### `SOURCE_ID` - Origen

- tipo: `crm_status`
- leads con valor: `6408`
- valores distintos usados: `6`
- opciones posibles:
- `CALL`: Llamada | usados: 6263
- `EMAIL`: E-Mail | usados: 6
- `WEB`: Sitio Web | usados: 0
- `ADVERTISING`: Publicidad | usados: 108
- `PARTNER`: Cliente Existente | usados: 0
- `RECOMMENDATION`: Por Recomendación | usados: 0
- `WEBFORM`: Formulario del CRM | usados: 11
- `CALLBACK`: Devolver la llamada | usados: 0
- `BOOKING`: Reserva online | usados: 0
- `RC_GENERATOR`: Impulso de ventas | usados: 0
- `STORE`: Tienda online | usados: 0
- `OTHER`: Otro | usados: 2
- `3|WHATSAPPBYEDNA`: Edna.io WhatsApp - COBRANZAS | usados: 18
- `5|FACEBOOK`: Facebook - Canal Abierto 3 | usados: 0
- `7|WZ_WHATSAPP_CD25BC049A1B261A4C2010F6A878C6F7F`: WAZZUP: WhatsApp - Canal Abierto 4 | usados: 0
- `3|FBINSTAGRAMDIRECT`: Instagram Direct - Canal Abierto 2 | usados: 0
- `3|WZ_WHATSAPP_CD25BC049A1B261A4C2010F6A878C6F7F`: WAZZUP: WhatsApp - Canal Abierto 2 | usados: 0
- `1|WZ_WHATSAPP_CD25BC049A1B261A4C2010F6A878C6F7F`: WAZZUP: WhatsApp - Canal Abierto | usados: 0
- `1|FBINSTAGRAMDIRECT`: Instagram Direct - Canal Abierto | usados: 0
- `1|FACEBOOK`: Facebook - Canal Abierto | usados: 0
- `1|FACEBOOKCOMMENTS`: Facebook: Comentarios - Canal Abierto | usados: 0
- `WZae27694d-55a5-47a6-83bd-df56fc657925`: Whatsapp 5493517616770 | usados: 0
- `WZfed5ea90-cbad-45fb-a78c-cd2b2ab93d5a`: Whatsapp 5493515167863 | usados: 0
- `WZfb8291af-1f63-4ed7-865a-c6d16fe7ddc2`: Instagram redunisol | usados: 0
- `UC_8JFZKD`: Common Sense | usados: 0
- `UC_92QPSU`: Campaña Mupol | usados: 0
- `UC_NG3SB8`: Campaña Pre Aprobado | usados: 0
- `UC_NV3ZAK`: Atencion Presencial | usados: 0
- `4`: Formulario Facebook | usados: 0
- `WZ5134e4b3-8764-4cf8-bbc3-352adadf04ee`: Whatsapp 5493517038577 | usados: 0
- `REPEAT_SALE`: Ventas recurrentes | usados: 0
- `WZ6f34ce07-000f-4d4c-a92b-d7c769db0f1b`: Whatsapp 5493513298004 | usados: 0

### `STATUS_ID` - Etapa

- tipo: `crm_status`
- leads con valor: `6408`
- valores distintos usados: `19`
- opciones posibles:
- `NEW`: INGRESO PROSPECTO | usados: 0
- `UC_PWTVG6`: test | usados: 170
- `UC_64AUC9`: RESULTADO GANADO | usados: 138
- `CONVERTED`: ANALISIS | usados: 1494
- `JUNK`: OTRA PROVINCIA | usados: 161
- `UC_1P8I07`: RESULTADO PERDIDO | usados: 0
- `UC_2B72LN`: SIT NEG BCRA | usados: 190
- `UC_71EBSI`: SIN RESPUESTA | usados: 540
- `1`: OTRO BANCO | usados: 299
- `2`: NO TIENE ANTIGUEDAD | usados: 0
- `3`: AUTONOMO | usados: 770
- `4`: AUH (asignaciones) | usados: 255
- `UC_LG4IKC`: JUBILADO PROVINCIAL | usados: 58
- `UC_3L8S0S`: PENSIONADO | usados: 60
- `UC_TJVEF4`: JUBILADO NACIONAL | usados: 414
- `UC_PO398Z`: PUBLICO NACIONAL | usados: 159
- `5`: NO TIENE RECIBO (en negro) | usados: 0
- `6`: CONTRATADO | usados: 0
- `7`: NUMERO INCORRECTO | usados: 24
- `8`: PRIVADOS | usados: 1249
- `9`: MUNICIPAL | usados: 282
- `10`: NO CUMPLE REQUISITOS PARA CONVENIO | usados: 40
- `13`: NEGOCIACION CON VENDEDOR | usados: 104
- `14`: NO SON SOCIOS NI QUIEREN PRESTAMO | usados: 1

### `UF_CRM_1714071903` - Sit Laboral

- tipo: `enumeration`
- leads con valor: `6277`
- valores distintos usados: `13`
- opciones posibles:
- `1239`: Empleado Publico Provincial | usados: 1779
- `1273`: Empleado Publico Municipal | usados: 417
- `1271`: Empleado publico Nacional | usados: 166
- `1241`: Empleado Privado | usados: 1292
- `1269`: Policia | usados: 177
- `2567`: Jubilado Nacional | usados: 450
- `2565`: Jubilado Provincial | usados: 572
- `3129`: Jubilado Municipal | usados: 24
- `1277`: Autonomo/Independiente | usados: 543
- `3131`: Monotributista | usados: 278
- `2569`: Pensionado | usados: 261
- `1279`: Beneficiario de Plan Social | usados: 273
- `3745`: Docente | usados: 45
- `1275`: Jubilado/Pensionado FUERA DE USO | usados: 0

### `UF_CRM_1718209943683` - Nueva lista

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `2387`: Campo Test | usados: 0

### `UF_CRM_1718209975147` - Campo Test

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `2389`: Test 1 | usados: 0
- `2391`: Test 2 | usados: 0

### `UF_CRM_1722365051` - origenFormulario

- tipo: `enumeration`
- leads con valor: `6278`
- valores distintos usados: `7`
- opciones posibles:
- `2423`: Google | usados: 2038
- `2425`: Facebook | usados: 2347
- `2427`: Instagram | usados: 854
- `2451`: Campaña WhatsApp | usados: 439
- `2647`: Campaña E-Mail | usados: 241
- `3729`: Finguru | usados: 285
- `3737`: Suscripción News Celesol | usados: 0
- `3921`: YouTube | usados: 74

### `UF_CRM_1725370937` - Tipo Campaña Desplegable Prospecto

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `2499`: Activos CBU | usados: 0
- `2501`: Activos Haberes | usados: 0
- `2503`: Campaña Patricia | usados: 0
- `2505`: Campaña Gloria | usados: 0
- `2547`: CBU REFINANCIACION | usados: 0
- `2549`: CBU PARALELOS | usados: 0
- `2551`: HABERES REFINANCIACION | usados: 0
- `2589`: Campaña PROMOCION | usados: 0
- `2641`: Campaña SMS Inactivos | usados: 0

### `UF_CRM_1728998183` - YaSoySocio

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `2617`: Si | usados: 0
- `2619`: No | usados: 0

### `UF_CRM_64E65D2B2136C` - ProvinciaContacto

- tipo: `enumeration`
- leads con valor: `6240`
- valores distintos usados: `24`
- opciones posibles:
- `209`: Cordoba | usados: 4164
- `211`: Rio Negro | usados: 14
- `213`: Neuquen | usados: 8
- `215`: Catamarca | usados: 1818
- `217`: Chubut | usados: 12
- `219`: Jujuy | usados: 3
- `221`: Buenos Aires | usados: 65
- `255`: Chaco | usados: 2
- `257`: Corrientes | usados: 4
- `259`: Entre Ríos | usados: 9
- `261`: Formosa | usados: 2
- `263`: La Pampa | usados: 5
- `265`: La Rioja | usados: 19
- `267`: Mendoza | usados: 11
- `269`: Misiones | usados: 6
- `271`: Salta | usados: 6
- `273`: San Juan | usados: 5
- `275`: San Luis | usados: 5
- `277`: Santa Cruz | usados: 4
- `279`: Santa Fe | usados: 30
- `281`: Santiago del Estero | usados: 9
- `283`: Tierra del Fuego | usados: 2
- `285`: Tucumán | usados: 10
- `431`: No contesta | usados: 27

### `UF_CRM_67F67D69DFE9C` - Formato del evento

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3437`: Virtual (en línea) | usados: 0
- `3439`: Presencial | usados: 0
- `3441`: Veré la transmisión grabada | usados: 0

### `UF_CRM_LEAD_1711458190312` - Banco de Cobro

- tipo: `enumeration`
- leads con valor: `6408`
- valores distintos usados: `48`
- opciones posibles:
- `437`: BANCO DE LA PROVINCIA DE CORDOBA S.A. | usados: 0
- `439`: BANCO DE LA NACION ARGENTINA | usados: 0
- `441`: BANCO DE LA PAMPA SOCIEDAD DE ECONOMÍA | usados: 0
- `443`: BANCO PROVINCIA DEL NEUQUÉN SOCIEDAD ANÓNIMA | usados: 0
- `445`: BANCO PATAGONIA S.A. | usados: 0
- `447`: BBVA BANCO FRANCES S.A. | usados: 0
- `449`: BANCO SANTANDER RIO S.A. | usados: 0
- `451`: BANCO DEL CHUBUT S.A. | usados: 0
- `453`: HSBC BANK ARGENTINA S.A. | usados: 0
- `455`: BANCO ITAU ARGENTINA S.A. | usados: 0
- `457`: BANCO MACRO S.A. | usados: 0
- `459`: BANCO DE GALICIA Y BUENOS AIRES S.A.U. | usados: 0
- `461`: BANCO DE LA PROVINCIA DE BUENOS AIRES | usados: 0
- `463`: INDUSTRIAL AND COMMERCIAL BANK OF CHINA | usados: 0
- `465`: CITIBANK N.A. | usados: 0
- `467`: BANCO BBVA ARGENTINA S.A. | usados: 0
- `469`: BANCO SUPERVIELLE S.A. | usados: 0
- `471`: BANCO DE LA CIUDAD DE BUENOS AIRES | usados: 0
- `473`: BANCO HIPOTECARIO S.A. | usados: 0
- `475`: BANCO DE SAN JUAN S.A. | usados: 0
- `477`: BANCO MUNICIPAL DE ROSARIO | usados: 0
- `479`: BANCO DE SANTA CRUZ S.A. | usados: 0
- `481`: BANCO DE CORRIENTES S.A. | usados: 0
- `483`: BANK OF CHINA LIMITED SUCURSAL BUENOS AI | usados: 0
- `485`: BRUBANK S.A.U. | usados: 0
- `487`: BIBANK S.A. | usados: 0
- `489`: OPEN BANK ARGENTINA S.A. | usados: 0
- `491`: JPMORGAN CHASE BANK, NATIONAL ASSOCIATION | usados: 0
- `493`: BANCO CREDICOOP COOPERATIVO LIMITADO | usados: 0
- `495`: BANCO DE VALORES S.A. | usados: 0
- `497`: BANCO ROELA S.A. | usados: 0
- `499`: BANCO MARIVA S.A. | usados: 0
- `501`: BNP PARIBAS | usados: 0
- `503`: BANCO PROVINCIA DE TIERRA DEL FUEGO | usados: 0
- `505`: BANCO DE LA REPUBLICA ORIENTAL DEL URUGU | usados: 0
- `507`: BANCO SAENZ S.A. | usados: 0
- `509`: BANCO MERIDIAN S.A. | usados: 0
- `511`: BANCO COMAFI SOCIEDAD ANONIMA | usados: 0
- `513`: BANCO DE INVERSION Y COMERCIO EXTERIOR S | usados: 0
- `515`: BANCO PIANO S.A. | usados: 0
- `517`: BANCO JULIO SOCIEDAD ANONIMA | usados: 0
- `519`: BANCO RIOJA SOCIEDAD ANONIMA UNIPERSONAL | usados: 0
- `521`: BANCO DEL SOL S.A. | usados: 0
- `523`: NUEVO BANCO DEL CHACO S. A. | usados: 0
- `525`: BANCO VOII S.A. | usados: 0
- `527`: BANCO DE FORMOSA S.A. | usados: 0
- `529`: BANCO CMF S.A. | usados: 0
- `531`: BANCO DE SANTIAGO DEL ESTERO S.A. | usados: 0
- `533`: BANCO INDUSTRIAL S.A. | usados: 0
- `535`: NUEVO BANCO DE SANTA FE SOCIEDAD ANONIMA | usados: 0
- `537`: BANCO CETELEM ARGENTINA S.A. | usados: 0
- `539`: BANCO DE SERVICIOS FINANCIEROS S.A. | usados: 0
- `541`: BANCO DE SERVICIOS Y TRANSACCIONES S.A. | usados: 0
- `543`: RCI BANQUE S.A. | usados: 0
- `545`: BACS BANCO DE CREDITO Y SECURITIZACION S | usados: 0
- `547`: BANCO MASVENTAS S.A. | usados: 0
- `549`: WILOBANK S.A.U. | usados: 0
- `551`: NUEVO BANCO DE ENTRE RÍOS S.A. | usados: 0
- `553`: BANCO COLUMBIA S.A. | usados: 0
- `555`: BANCO BICA S.A. | usados: 0
- `557`: BANCO DE COMERCIO S.A. | usados: 0
- `559`: BANCO SUCREDITO REGIONAL S.A.U. | usados: 0
- `561`: BANCO DINO S.A. | usados: 0
- `563`: COMPAÑIA FINANCIERA ARGENTINA S.A. | usados: 0
- `565`: VOLKSWAGEN FINANCIAL SERVICES COMPAÑIA F | usados: 0
- `567`: IUDU COMPAÑÍA FINANCIERA S.A. | usados: 0
- `569`: FCA COMPAÑIA FINANCIERA S.A. | usados: 0
- `571`: GPAT COMPAÑIA FINANCIERA S.A.U. | usados: 0
- `573`: MERCEDES-BENZ COMPAÑÍA FINANCIERA ARGENT | usados: 0
- `575`: ROMBO COMPAÑÍA FINANCIERA S.A. | usados: 0
- `577`: JOHN DEERE CREDIT COMPAÑÍA FINANCIERA S. | usados: 0
- `579`: PSA FINANCE ARGENTINA COMPAÑÍA FINANCIER | usados: 0
- `581`: TOYOTA COMPAÑÍA FINANCIERA DE ARGENTINA | usados: 0
- `583`: NARANJA DIGITAL COMPAÑÍA FINANCIERA S.A. | usados: 0
- `585`: MONTEMAR COMPAÑIA FINANCIERA S.A. | usados: 0
- `587`: REBA COMPAÑIA FINANCIERA S.A. | usados: 0
- `589`: CREDITO REGIONAL COMPAÑIA FINANCIERA S.A | usados: 0
- `591`: BANCO COINAG S.A. | usados: 0
- `593`: Otros | usados: 0

### `UF_CRM_LEAD_1713891450015` - ¿Invertirías nuevamente con nosotros?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `1071`: 1 | usados: 0
- `1073`: 2 | usados: 0
- `1075`: 3 | usados: 0
- `1077`: 4 | usados: 0
- `1079`: 5 | usados: 0

### `UF_CRM_LEAD_1713891616703` - ¿Cómo consideras que fue la atención recibida?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `1081`: 1 | usados: 0
- `1083`: 2 | usados: 0
- `1085`: 3 | usados: 0
- `1087`: 4 | usados: 0
- `1089`: 5 | usados: 0

### `UF_CRM_LEAD_1713892443039` - ¿Qué tan clara fue la información proporcionada?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `1111`: 1 | usados: 0
- `1113`: 2 | usados: 0
- `1115`: 3 | usados: 0
- `1117`: 4 | usados: 0
- `1119`: 5 | usados: 0

### `UF_CRM_LEAD_1713892664047` - ¿Recomendarías a alguien que invierta con nosotros?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `1131`: Si | usados: 0
- `1133`: No | usados: 0

### `UF_CRM_LEAD_1713892735279` - ¿Qué tan satisfecho estás operando con nosotros?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `1135`: 1 | usados: 0
- `1137`: 2 | usados: 0
- `1139`: 3 | usados: 0
- `1141`: 4 | usados: 0
- `1143`: 5 | usados: 0

### `UF_CRM_LEAD_1744204544142` - ¿Cuál es tu nivel de conocimiento sobre inversiones?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3317`: Ninguno, quiero aprender desde cero. | usados: 0
- `3319`: Básico, tengo algo de conocimiento pero nunca invertí. | usados: 0
- `3321`: Intermedio, ya hice algunas inversiones. | usados: 0
- `3323`: Avanzado, tengo experiencia invirtiendo regularmente. | usados: 0

### `UF_CRM_LEAD_1744204643309` - ¿En qué tipo de inversiones has participado?

- tipo: `enumeration`
- leads con valor: `6408`
- valores distintos usados: `1`
- opciones posibles:
- `3325`: Plazo fijo tradicional | usados: 0
- `3327`: Fondos de inversión | usados: 0
- `3329`: Alternativas mutuales o cooperativas | usados: 0
- `3331`: Criptomonedas | usados: 0
- `3333`: Acciones o bonos | usados: 0
- `3335`: Emprendimientos o negocios propios | usados: 0
- `3337`: No he invertido antes | usados: 0
- `3339`: Otros | usados: 0

### `UF_CRM_LEAD_1744204756446` - ¿Cuál es tu horizonte de inversión?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3341`: Corto plazo (30-90 días) | usados: 0
- `3343`: Mediano plazo (3-12 meses) | usados: 0
- `3345`: Largo plazo (más de 1 año) | usados: 0
- `3347`: No estoy seguro, quiero recibir asesoramiento | usados: 0

### `UF_CRM_LEAD_1744204826685` - ¿Qué monto estimado te gustaría invertir?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3349`: Menos de $5.000.000 | usados: 0
- `3351`: Entre $5.000.000 y $20.000.000 | usados: 0
- `3353`: Más de $20.000.000 | usados: 0

### `UF_CRM_LEAD_1745945463707` - ¿Cuál es tu nivel de conocimiento sobre inversiones?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3575`: Ninguno, quiero aprender desde cero. | usados: 0
- `3577`: Básico, tengo algo de conocimiento pero nunca invertí. | usados: 0
- `3579`: Intermedio, ya hice algunas inversiones. | usados: 0
- `3581`: Avanzado, tengo experiencia invirtiendo regularmente. | usados: 0

### `UF_CRM_LEAD_1745945592698` - ¿Cómo preferís recibir más información?

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3583`: Por correo electrónico | usados: 0
- `3585`: Por llamada telefónica | usados: 0
- `3587`: Por WhatsApp | usados: 0

### `UF_CRM_LEAD_1750865276469` - ¿Cómo te enteraste del webinar? 

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3625`: Email | usados: 0
- `3627`: WhatsApp | usados: 0
- `3629`: Linked In | usados: 0
- `3631`: Recomendación | usados: 0
- `3633`: Otro | usados: 0

### `UF_CRM_LEAD_1750865501620` - ¿Conocés el producto Ahorro Mutual a Término de Celesol?  

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3635`: Si | usados: 0
- `3637`: No | usados: 0

### `UF_CRM_REJECTION_REASON` - Motivo Rechazo

- tipo: `enumeration`
- leads con valor: `0`
- valores distintos usados: `0`
- opciones posibles:
- `3933`: OTRA PROVINCIA | usados: 0
- `3935`: SIT NEG BCRA | usados: 0
- `3937`: SIN RESPUESTA | usados: 0
- `3939`: OTRO BANCO | usados: 0
- `3941`: NO TIENE ANTIGUEDAD | usados: 0
- `3943`: AUTONOMO | usados: 0
- `3945`: AUH (asignaciones) | usados: 0
- `3947`: JUBILADO PROVINCIAL | usados: 0
- `3949`: PENSIONADO | usados: 0
- `3951`: JUBILADO NACIONAL | usados: 0
- `3953`: PUBLICO NACIONAL | usados: 0
- `3955`: NO TIENE RECIBO (en negro) | usados: 0
- `3957`: CONTRATADO | usados: 0
- `3959`: NUMERO INCORRECTO | usados: 0
- `3961`: PRIVADOS | usados: 0
- `3963`: MUNICIPAL | usados: 0
- `3965`: NO CUMPLE REQUISITOS PARA CONVENIO | usados: 0
- `3967`: NO SON SOCIOS NI QUIEREN PRESTAMO | usados: 0

## Campos sin uso en la ventana

- total sin uso en la ventana: `68`
- `HONORIFIC` - Saludo
- `SECOND_NAME` - Segundo nombre
- `BIRTHDATE` - Fecha de nacimiento
- `SOURCE_DESCRIPTION` - Información de origen
- `STATUS_DESCRIPTION` - Más información sobre esta etapa
- `POST` - Cargo
- `ADDRESS` - Dirección
- `ADDRESS_2` - Dirección (línea 2)
- `ADDRESS_CITY` - Ciudad
- `ADDRESS_POSTAL_CODE` - Código Postal
- `ADDRESS_REGION` - Región
- `ADDRESS_PROVINCE` - Estado / Provincia
- `ADDRESS_COUNTRY` - País
- `ADDRESS_COUNTRY_CODE` - Código de País
- `ADDRESS_LOC_ADDR_ID` - Location address ID
- `COMPANY_ID` - Compañía
- `CONTACT_IDS` - CONTACT_IDS
- `UTM_SOURCE` - Fuente de campaña
- `UTM_MEDIUM` - Medio
- `UTM_CAMPAIGN` - UTM de campaña publicitaria
- `UTM_CONTENT` - Contenido de campaña
- `UTM_TERM` - Término de búsqueda de campaña
- `UF_CRM_INSTAGRAM_WZ` - Instagram_WZ
- `UF_CRM_VK_WZ` - VK_WZ
- `UF_CRM_TELEGRAMUSERNAME_WZ` - TelegramUsername_WZ
- `UF_CRM_TELEGRAMID_WZ` - TelegramId_WZ
- `UF_CRM_AVITO_WZ` - Avito_WZ
- `UF_CRM_LEAD_1682354378894` - Información Córdoba
- `UF_CRM_LEAD_1682363576115` - cba
- `UF_CRM_LEAD_1682363594356` - neuquen
- `UF_CRM_LEAD_1682363609836` - TIPO DE CAMPAÑA (NO SE USA)
- `UF_CRM_LEAD_1686666713875` - Ocupación
- `UF_CRM_LEAD_1686669327915` - Ocupación
- `UF_CRM_1704896253508` - Linea
- `UF_CRM_LEAD_1706733987482` - Movimientos bancarios
- `UF_CRM_LEAD_1706740387059` - E-mail
- `UF_CRM_LEAD_1713890924023` - Satisfacción
- `UF_CRM_LEAD_1713891027110` - 1
- `UF_CRM_LEAD_1713891380847` - Claridad de información
- `UF_CRM_LEAD_1713891450015` - ¿Invertirías nuevamente con nosotros?
- `UF_CRM_LEAD_1713891616703` - ¿Cómo consideras que fue la atención recibida?
- `UF_CRM_LEAD_1713892443039` - ¿Qué tan clara fue la información proporcionada?
- `UF_CRM_LEAD_1713892664047` - ¿Recomendarías a alguien que invierta con nosotros?
- `UF_CRM_LEAD_1713892735279` - ¿Qué tan satisfecho estás operando con nosotros?
- `UF_CRM_1715713060` - Nombre Prospecto
- `UF_CRM_1715713079` - Apellido Prospecto
- `UF_CRM_1716907209` - Origen
- `UF_CRM_1718209943683` - Nueva lista
- `UF_CRM_1718209975147` - Campo Test
- `UF_CRM_1725370937` - Tipo Campaña Desplegable Prospecto
- `UF_CRM_1728998183` - YaSoySocio
- `UF_CRM_1730295104` - nombreReferente
- `UF_CRM_1730295133` - contactoReferente
- `UF_CRM_1730905774354` - socioReferente
- `UF_CRM_LEAD_1744204544142` - ¿Cuál es tu nivel de conocimiento sobre inversiones?
- `UF_CRM_LEAD_1744204756446` - ¿Cuál es tu horizonte de inversión?
- `UF_CRM_LEAD_1744204826685` - ¿Qué monto estimado te gustaría invertir?
- `UF_CRM_67F67D69DFE9C` - Formato del evento
- `UF_CRM_LEAD_1745945463707` - ¿Cuál es tu nivel de conocimiento sobre inversiones?
- `UF_CRM_LEAD_1745945592698` - ¿Cómo preferís recibir más información?
- `UF_CRM_LEAD_1745946540876` - Entidad
- `UF_CRM_LEAD_1750865276469` - ¿Cómo te enteraste del webinar? 
- `UF_CRM_LEAD_1750865501620` - ¿Conocés el producto Ahorro Mutual a Término de Celesol?  
- `UF_CRM_MAXUSERNAME_WZ` - MaxUsername_WZ
- `UF_CRM_MAXID_WZ` - MaxId_WZ
- `UF_CRM_REJECTION_REASON` - Motivo Rechazo
- `UF_CRM_WHATSAPPUSERNAME_WZ` - WhatsappUsername_WZ
- `UF_CRM_WHATSAPPLID_WZ` - WhatsappLid_WZ

## Observaciones operativas

- `SOURCE_ID` es nativo, pero en los leads recientes del webhook aparece mayormente como `CALL`, por lo que hoy no diferencia bien el origen real de captura.
- El canal de marketing real hoy queda en el custom `origenFormulario` (`UF_CRM_1722365051`).
- El flujo de Kestra usa un subconjunto chico de campos y no gobierna el resto de la superficie del lead.

## Propuesta de cleanup

1. Ocultar o revisar campos custom con valor fijo/default en toda la ventana. Ejemplos: `UF_CRM_1690295643293` (Enviado), `UF_CRM_1716466733` (Situacion Laboral), `UF_CRM_1716466790` (Banco de Cobro Cliente), `UF_CRM_1716466829` (Provincia de Contacto), `UF_CRM_LEAD_1713892502679` (Recomendación), `UF_CRM_LEAD_1713892573319` (¿Recomendarías a alguien que invierta con nosotros?), `UF_CRM_LEAD_1744204643309` (¿En qué tipo de inversiones has participado?). Estos campos hoy agregan ruido, no señal.
2. Consolidar duplicados de negocio entre campos enumerados vigentes y variantes legacy/string. Pares detectados: `UF_CRM_1714071903` (Sit Laboral) vs `UF_CRM_1716466733` (Situacion Laboral); `UF_CRM_64E65D2B2136C` (ProvinciaContacto) vs `UF_CRM_1716466829` (Provincia de Contacto); `UF_CRM_LEAD_1711458190312` (Banco de Cobro) vs `UF_CRM_1716466790` (Banco de Cobro Cliente); `UF_CRM_LEAD_1711458190312` (Banco de Cobro) vs `UF_CRM_LEAD_1706273705244` (Banco de Cobro).
3. Unificar el rechazo en una etapa perdida unica y usar `UF_CRM_REJECTION_REASON` para el motivo. Hoy el campo de motivo no tiene uso en la ventana, mientras la etapa absorbe muchos motivos de negocio.
4. Normalizar la estrategia de origen. `SOURCE_ID` esta dominado por `CALL`, mientras el canal real vive en `UF_CRM_1722365051` (`origenFormulario`). Definir si `SOURCE_ID` sera macro-origen y el custom subcanal, o si se migra toda la semantica a un solo contrato.
5. Depurar campos custom sin uso real en la ventana. Hay `46` candidatos; primeros ejemplos: `UF_CRM_1704896253508`, `UF_CRM_1715713060`, `UF_CRM_1715713079`, `UF_CRM_1716907209`, `UF_CRM_1718209943683`, `UF_CRM_1718209975147`, `UF_CRM_1725370937`, `UF_CRM_1728998183`, `UF_CRM_1730295104`, `UF_CRM_1730295133`, `UF_CRM_1730905774354`, `UF_CRM_67F67D69DFE9C`.
6. Versionar como contrato minimo de integracion los campos que el webhook escribe hoy, para que futuras automatizaciones no vuelvan a depender de campos manuales o legacy.
