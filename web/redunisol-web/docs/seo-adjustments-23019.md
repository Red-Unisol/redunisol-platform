# Ajustes SEO — Bitrix #23019

La tarea corrige titulos y metadatos duplicados, el banner del blog, etiquetas
de navegacion sin configurar, enlaces repetidos en el footer y URLs retiradas.

## Metadatos

- `HandleInertiaRequests` obtiene titulo, descripcion, canonical y datos sociales
  de la pagina o articulo administrado en Filament.
- `SeoHead` usa esos datos en React, con claves estables para Inertia.
- `app.blade.php` los publica tambien en el HTML inicial cuando SSR no responde.
  Si SSR devuelve el head, no se agregan las etiquetas de respaldo.
- El formateo del titulo es idempotente: no vuelve a agregar la marca cuando el
  titulo configurado ya contiene `Red Unisol`.

## Redirecciones

Las reglas revisadas de la migracion se versionan en `config/redirects.php`.
Tienen prioridad sobre las reglas editables de Filament, responden 301 para
GET/HEAD y conservan la query de origen, incluidos UTM y los identificadores
de clic. Sus origenes se excluyen del sitemap aunque sigan indexados en el CMS.

El 16/09/2026 se verifico en el sitio publico:

| URL | Estado antes del cambio |
| --- | --- |
| `/jubilados-de-cordoba` | 404 |
| `/jubilados-de-cordoba/form-abajo` | 404 |
| `/prestamos-para-jubilados/jubilados-cordoba` | 200 |

Por eso los dos nombres abreviados del ticket y la variante real
`/prestamos-para-jubilados/jubilados-cordoba/form-abajo` apuntan directamente
a la landing vigente, sin una parada intermedia en el nombre abreviado.

**Pendiente para completar el punto 1:** incorporar las columnas A/B de la
[planilla de Portico 8](https://docs.google.com/spreadsheets/d/1kWXNm8Uo6mrY5xn9iaI6C7yDkdexDX_sGsko-9VzfwQ/edit?gid=0).
El acceso anonimo devuelve 401. No se infieren destinos para las demas URLs
historicas. Al recibir la planilla, agregar las reglas verificadas al mapa y
comprobar que cada origen entrega 301 y cada destino final entrega 200, sin ciclos.

## Validacion

```sh
php artisan test tests/Feature/PageSeoMetadataTest.php tests/Feature/SiteSeoAdjustmentsTest.php
npm run build:ssr
```

Las pruebas cubren el HTML inicial, el respaldo frente a SSR, los metadatos del
blog, las redirecciones con atribucion y la exclusion de URLs retiradas del sitemap.
Tambien se probo el bundle SSR con respuestas renderizadas de landing, blog,
categoria y autor: una etiqueta por metadato, un enlace del footer a Sobre Nosotros,
y navegacion sin la etiqueta generica. El encabezado del blog se sirve visible.

Antes de cerrar la tarea, Marketing y la agencia deben validar las paginas
publicadas, el banner en escritorio y movil, y el listado completo de redirecciones.
