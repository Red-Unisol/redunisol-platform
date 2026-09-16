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

## Mapa de la agencia

Se incorporaron las 188 filas de `Redirecciones 301 - Red Unisol.xlsx`, hoja
`htaccess`, rango `A2:B189`, descargado el 16/09/2026 desde la
[planilla de Portico 8](https://docs.google.com/spreadsheets/d/1kWXNm8Uo6mrY5xn9iaI6C7yDkdexDX_sGsko-9VzfwQ/edit?gid=0).
SHA-256 del Excel: `6d8aee33faf97da988ee00c5af8fe05fbf361811108a7a8fb73c5ad6f187e5ad`.

La hoja `htaccess` contiene las 179 fuentes de `Hoja 1`, agrega 9 y reemplaza
3 destinos que apuntaban a su propio origen por destinos del sitio actual.
Se usa esa hoja completa; el CSV de prueba conserva sus 188 pares originales.

`config/legacy_redirects.php` contiene 183 reglas unicas tras unificar HTTP/HTTPS,
www y barra final. Los destinos usan HTTPS en el dominio principal, sin barra
final excepto en la raiz. Se verificaron los 82 destinos distintos de la hoja:
todos respondieron HTTP 200 el 16/09/2026.

| Dominio de origen | Reglas unicas |
| --- | ---: |
| `prestamos.redunisol.com.ar` | 162 |
| `redunisol.com.ar` y `www.redunisol.com.ar` | 20 |
| `dev.redunisol.com.ar` | 1 |

Las reglas respetan el dominio: una URL antigua de `prestamos` no cambia una
pagina actual del dominio principal que tenga el mismo path. El destino de la
URL de empleados UNC difiere entre `dev` y `www`, tal como indica la agencia.
Las reglas ignoran la query al identificar el origen y la conservan al redirigir.
Se soportan PDFs con espacios y tildes codificados y el comodin limitado a
`/wp-content/themes/redunisol/*`; no se aplican comodines generales.

### Requisito operativo del subdominio retirado

`prestamos.redunisol.com.ar` no resolvia por DNS el 16/09/2026 (NXDOMAIN,
confirmado tambien con el resolver 1.1.1.1). Sus 162 reglas estan implementadas,
pero no podran responder hasta que el dominio llegue al runtime de esta app.

Al desplegar, el operador debe:

1. Restaurar el registro DNS de `prestamos.redunisol.com.ar` hacia el ingreso de
   produccion, verificando el destino vigente; no usar direcciones de checkpoints.
2. Cubrir ese nombre con TLS y con el virtual host/proxy de la web publica,
   preservando el Host original (`ProxyPreserveHost On` si se usa Apache).
   Evitar una redireccion general al dominio principal antes de llegar a Laravel,
   porque perderia la distincion entre los paths de ambos sitios.
3. Verificar HTTP y HTTPS de los origenes, el 301 al destino esperado y el 200
   final, incluyendo query UTM. Los dominios principal/www y dev deben seguir
   sirviendo sus sitios respectivos.

No se modificaron DNS, certificados ni virtual hosts durante la implementacion.

## Validacion

```sh
php artisan test tests/Unit/ManagedRedirectsTest.php tests/Feature/PageSeoMetadataTest.php tests/Feature/SiteSeoAdjustmentsTest.php
npm run build:ssr
```

Las pruebas cubren el HTML inicial, el respaldo frente a SSR, los metadatos del
blog, cada fila del Excel con GET/HEAD y atribucion, limites de dominio y comodin,
ausencia de ciclos, conservacion de POST y exclusion de URLs retiradas del sitemap.
Tambien se probo el bundle SSR con respuestas renderizadas de landing, blog,
categoria y autor: una etiqueta por metadato, un enlace del footer a Sobre Nosotros,
y navegacion sin la etiqueta generica. El encabezado del blog se sirve visible.

Antes de cerrar la tarea, Marketing y la agencia deben validar las paginas
publicadas, el banner en escritorio y movil, y el listado completo de redirecciones.
