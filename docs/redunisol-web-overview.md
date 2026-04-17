# Redunisol Web Overview

Esta guia resume como funciona `web/redunisol-web`, que tecnologias usa, como se modifica y por donde conviene ampliarla.

No reemplaza el runbook operativo ni el operating model. Su objetivo es acortar la curva de entrada para alguien que no participo del desarrollo original.

## Que Es Hoy

`redunisol-web` funciona hoy como una app Laravel con frontend React que cumple cuatro roles principales:

- publicar landings publicas por slug
- permitir administrar contenido desde Filament
- capturar leads desde formularios multi-step
- reenviar esos leads a Kestra en vez de persistirlos como CRM local

La idea importante es esta:

- la URL publica busca una pagina en base de datos
- esa pagina tiene un arreglo JSON de secciones
- una sola pagina React renderiza esas secciones segun su `type`
- el formulario arma un payload y lo envia al backend Laravel
- Laravel valida y reenvia la solicitud a Kestra

## Stack Tecnologico

### Backend

- PHP 8.4
- Laravel 12
- Inertia Laravel
- Filament 4 para admin
- Laravel Fortify para auth base
- Predis para Redis
- `prinsfrank/pdfparser` para una utilidad puntual de busqueda en PDFs

### Frontend

- React 19
- TypeScript
- Vite 7
- Tailwind CSS 4
- Framer Motion para animaciones
- componentes UI armados sobre Radix

### Runtime

- `nginx`
- `php-fpm`
- PostgreSQL 18
- Redis
- storage persistente

Para el modelo operativo y el deploy ver tambien:

- `docs/redunisol-web-operating-model.md`
- `docs/redunisol-web-deploy-runbook.md`

## Mapa Mental Rapido

Pensalo en tres capas:

1. publicacion de contenido
2. captura de leads
3. administracion y operaciones

### 1. Publicacion de contenido

Las rutas publicas viven en `routes/web.php`.

El comportamiento real es este:

- `/health` expone un healthcheck de base, redis y storage
- `/admin` entra por Filament
- cualquier otra URL publica cae en un catch-all por slug

Ese catch-all transforma la URL en un slug tipo `/`, `/prestamos-para-policias` o `/prestamos-para-jubilados/jubilados-cordoba`, busca una fila en `pages` y renderiza la pagina Inertia `welcome`.

En otras palabras:

- no hay una ruta PHP distinta por landing
- no hay una pagina React distinta por landing
- hay una sola pantalla React que cambia segun el contenido guardado en `pages.sections`

### 2. Captura de leads

El formulario principal vive en el frontend y se renderiza como una seccion mas de la landing.

Hoy el flujo es este:

1. el usuario completa el formulario multi-step
2. si sube recibo, el frontend pega a `/api/recibos/upload`
3. el frontend arma el payload con datos de landing, formulario y UTM
4. el frontend envia JSON a `/api/form-submissions`
5. Laravel valida el request
6. Laravel transforma nombres de campos y reenvia a Kestra por webhook
7. Laravel devuelve al frontend la respuesta de Kestra o un error normalizado

Punto importante:

- hoy los leads no se guardan en una tabla local propia
- `redunisol-web` es una capa de captura, presentacion y forwarding hacia Kestra

### 3. Administracion y operaciones

El panel admin es Filament.

Hoy permite principalmente:

- administrar paginas publicas
- configurar secciones y campos del formulario por pagina
- administrar recursos de blog ya modelados en backend

Eso convive con el modelo operativo escenario B:

- Git define codigo, deploy, compose y configuracion declarativa
- la base, el storage y el contenido mutable administrado en runtime no viven completamente en Git

## Flujo De Request Publica

El recorrido normal de una landing es:

1. entra una request a `/{slug?}`
2. Laravel arma un slug normalizado
3. busca `Page::where('slug', $slug)->firstOrFail()`
4. renderiza `welcome` por Inertia con `landingSlug`, `sections` y `title`
5. React recorre `sections` y monta componentes segun `type`

Los tipos de seccion usados hoy son estos:

- `hero`
- `services`
- `about`
- `faqs`
- `convenios`
- `requisitos`
- `testimonios`
- `form`

Eso significa que si agregas una nueva pagina de contenido con el mismo esquema no necesitas una ruta nueva ni una pagina React nueva. Solo necesitas un nuevo registro `Page` con el slug correcto y sus secciones.

## Modelo De Datos Actual

### Tabla `pages`

Es la pieza central de contenido publico.

Campos principales:

- `title`
- `slug`
- `sections` JSON

`sections` se castea a array en el modelo. Ese JSON es el contrato entre Filament y React.

### Tabla `users`

Se usa para el acceso al admin y funcionalidades base de auth.

### Tablas `blogs`, `categories`, `blog_category`

Existen y tienen recursos de Filament, pero hoy no se ve una capa publica equivalente ya conectada en rutas web. O sea: parecen capacidad preparada o parcialmente implementada, no el centro del sitio publico actual.

### Jobs, queue y SSR

Hay soporte tecnico para queue y SSR porque la base del proyecto viene del starter kit Laravel + Inertia.

Sin embargo:

- no se ve una capa propia de jobs de negocio en `app/Jobs/`
- SSR esta configurado pero no aparece como pieza central del runtime validado actual

Conviene distinguir entre:

- capacidades del boilerplate
- piezas realmente usadas por el producto hoy

## Como Se Edita Contenido

Hay dos caminos.

### Camino 1: editar desde Filament

Es el camino natural para contenido mutable.

Sirve para:

- cambiar textos
- reordenar secciones
- habilitar o deshabilitar pasos del formulario
- configurar defaults de provincia, situacion laboral o banco
- crear o editar paginas existentes

Este camino impacta la base de datos runtime.

### Camino 2: editar seeds y JSON versionados

El contenido base inicial vive en `resources/js/data/pages/*.json` y se carga con `PageSeeder`.

Esto sirve para:

- definir un baseline versionado
- inicializar entornos nuevos
- reconstruir contenido base

Pero hay un matiz operativo importante:

- el deploy no aplica automaticamente `PageSeeder` en runtime hoy
- si el entorno no tiene paginas sembradas, puede levantar bien pero responder 404 en slugs publicos que no existan en `pages`

Checkpoint ya verificado:

- en dev hubo que correr manualmente `php artisan db:seed --class=PageSeeder --force` dentro del contenedor para poblar paginas faltantes

Conclusion pragmatica:

- Git define un baseline de contenido
- el runtime puede divergir si se edita desde admin
- hoy no hay una promotion automatica del contenido mutable entre ambientes

## Como Funciona El Formulario

El componente clave es `resources/js/components/sections/FormSection.tsx`.

Caracteristicas actuales:

- formulario multi-step
- pasos habilitables o deshabilitables por config
- labels configurables
- defaults configurables para campos deshabilitados
- upload opcional de recibo
- captura de `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- modales de resultado para exito, error o no califica

Los pasos activos hoy son:

1. datos personales
2. upload de recibo
3. provincia
4. situacion laboral y banco

No todos tienen que existir siempre. La pagina puede deshabilitar algunos pasos y enviar defaults.

Ese comportamiento se define en Filament dentro del builder del bloque `form`.

## Integracion Con Kestra

La integracion actual es backend-to-backend.

El frontend no llama a Kestra directo.

El flujo tecnico es este:

- frontend -> `/api/form-submissions`
- `FormSubmissionRequest` valida y normaliza
- `SubmitFormToKestra` transforma el payload
- Laravel hace `POST` a la webhook configurada en `KESTRA_FORM_WEBHOOK_URL`

Transformaciones relevantes que hace Laravel:

- `celular` -> `whatsapp`
- `provincia` -> `province`
- `situacion_laboral` -> `employment_status`
- `banco` -> `payment_bank`
- deduce `full_name` a partir del email o del contexto de landing
- mapea `utm_source` a `lead_source`
- agrega `submission_channel=redunisol-web`

Eso implica que si queres cambiar el contrato hacia Kestra, el lugar correcto no es solo el frontend. Tambien hay que tocar la accion backend.

## Variables De Entorno Que Importan De Verdad

Hay que distinguir dos grupos.

### Variables de runtime PHP/Laravel

Ejemplos actuales:

- `KESTRA_FORM_WEBHOOK_URL`
- `KESTRA_FORM_WEBHOOK_TIMEOUT_SECONDS`
- `KESTRA_FORM_DEFAULT_LEAD_SOURCE`
- `GTM_*` cuando Blade necesita renderizar integraciones web

Estas variables tienen que existir en el runtime efectivo y, en la topologia actual, tambien estar whitelisteadas en `deploy/docker-compose.vps.yml` para entrar a `php-fpm`.

### Variables de build frontend

Ejemplos actuales:

- `VITE_APP_NAME`
- `VITE_TRACKING_DEBUG`
- `VITE_GA4_DEBUG`

Estas afectan el build de assets y no necesariamente el runtime PHP.

La confusion entre ambos grupos ya genero incidentes reales, asi que conviene tratarlos como dos contratos distintos.

## Como Se Modifica Segun El Tipo De Cambio

### Si queres cambiar textos o contenido de una landing

Preferi Filament si el contenido es mutable.

Toca:

- admin de Pages

Si queres versionar un baseline:

- `resources/js/data/pages/*.json`
- `database/seeders/PageSeeder.php`

### Si queres cambiar diseño o presentacion

Toca:

- `resources/js/pages/welcome.tsx`
- `resources/js/components/*`
- `resources/css/app.css`

### Si queres cambiar la logica del formulario

Toca:

- `resources/js/components/sections/FormSection.tsx`
- `app/Http/Requests/FormSubmissionRequest.php`
- `app/Actions/SubmitFormToKestra.php`

### Si queres agregar una nueva landing con las mismas secciones

No hace falta una nueva ruta.

Necesitas:

- crear una `Page` nueva en admin o via seed
- usar un `slug` unico
- cargar `sections` validas para `welcome.tsx`

### Si queres agregar un nuevo tipo de seccion

Necesitas tocar cuatro lugares:

1. crear el componente React nuevo
2. hacer que `welcome.tsx` lo lea y renderice
3. agregar el bloque correspondiente en `PageResource`
4. opcionalmente agregar ejemplos en los JSON seed

### Si queres guardar leads localmente

Hoy eso no existe.

Habria que agregar:

- una tabla nueva tipo `leads`
- modelo y persistencia
- decision de cuando guardar: antes o despues del reenvio a Kestra
- posiblemente una vista admin o trazabilidad propia

### Si queres abrir el blog al publico

Hoy el backend y Filament ya tienen piezas para eso, pero faltaria al menos:

- rutas publicas web
- controladores o paginas Inertia/Blade publicas
- decision de SEO, slugs y relacion con las landings

## Cosas Que Parecen Boilerplate O Capacidad Latente

Conviene no asumir que todo lo que existe esta en produccion funcional.

Piezas que hoy parecen mas cercanas a scaffold o capacidad parcial:

- dashboard autenticado base
- settings de usuario y 2FA del starter kit
- soporte SSR de Inertia
- queue worker en scripts de desarrollo
- utilitario `/test` con busqueda de PDF
- recursos de blog aun no expuestos publicamente

Eso no significa que sobren. Significa que no deberias tomarlos automaticamente como parte del flujo principal del negocio actual.

## Riesgos O Blindspots A Tener Presentes

### Contenido en DB versus contenido en Git

Hoy conviven ambos. Eso facilita operar, pero complica trazabilidad si no se define que es baseline y que es contenido mutable del producto.

### Contrato flexible en `sections`

`sections` es JSON libre, asi que la compatibilidad entre admin y frontend depende de convenciones. Si agregas un `type` o cambias una forma interna, hay que coordinar ambas capas.

### Dependencia de Kestra para el lead flow

Si Kestra no responde o la config falta, la UX del formulario se degrada aunque la landing siga levantando bien.

### Seeder no automatico

Un entorno puede deployar la app correctamente y aun asi no tener todas las paginas publicas disponibles si `PageSeeder` no corrio.

### Credenciales admin por seed

El admin inicial se crea por seeder usando `ADMIN_EMAIL` y `ADMIN_PASSWORD`. En entornos reales conviene revisar eso explicitamente y no depender de defaults.

## Orden Recomendado Para Entenderla Rapido

Si alguien nuevo quiere leer el codigo en 15 a 20 minutos, este es un buen orden:

1. `routes/web.php`
2. `app/Models/Page.php`
3. `resources/js/pages/welcome.tsx`
4. `resources/js/components/sections/FormSection.tsx`
5. `app/Http/Requests/FormSubmissionRequest.php`
6. `app/Http/Controllers/FormSubmissionController.php`
7. `app/Actions/SubmitFormToKestra.php`
8. `app/Filament/Resources/Pages/PageResource.php`
9. `database/seeders/PageSeeder.php`
10. `docs/redunisol-web-operating-model.md`
11. `docs/redunisol-web-deploy-runbook.md`

## Resumen Ejecutivo

`redunisol-web` no es solo una pagina estatica ni solo un boilerplate Laravel.

Hoy es, en la practica:

- un publicador de landings basadas en slugs y secciones JSON
- un mini CMS con Filament para editar esas landings
- una UI de captura de leads con formulario configurable por pagina
- un puente backend hacia Kestra

La forma correcta de modificarla depende del cambio:

- contenido mutable: Filament
- baseline de contenido: JSON + seeders
- UI y experiencia: React/Tailwind
- integraciones y contrato de lead: Laravel backend + envs + deploy
- nuevas capacidades estructurales: coordinar DB, admin, frontend y operacion