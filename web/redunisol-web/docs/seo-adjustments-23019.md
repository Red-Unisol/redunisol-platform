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

### Configuracion del subdominio retirado

El 17/09/2026 el usuario restauro en Cloudflare el CNAME `prestamos` hacia
`redunisol.com.ar`, con proxy habilitado. Se configuro el ingreso por SSH con
su autorizacion explicita, conservando el estado deseado en Git:

- `deploy/apache/prestamos.redunisol.com.ar.conf` se instala en
  `/opt/apache/conf.d/30-prestamos-redunisol.conf`.
- El virtual host HTTPS preserva Host y envia las solicitudes a `127.0.0.1:3021`.
  Las reglas por dominio las resuelve Laravel; la raiz lleva al sitio principal.
- Certbot usa HTTP-01 con webroot `/opt/apache/htdocs`, y certificado independiente
  `prestamos.redunisol.com.ar`, emitido el 17/09/2026 y valido hasta el 16/12/2026.
- `deploy/apache/renew-prestamos-cert.sh` se instala con permiso 755 en
  `/opt/redunisol-web-prod/apache/renew-prestamos-cert.sh`. Es el deploy hook de
  ese certificado: valida Apache y hace una recarga gradual de `httpd`.
- `deploy/apache/letsencrypt.cron` conserva el horario del cron existente en
  `/etc/cron.d/letsencrypt`, pero dirige su hook global a `renew-web-cert.sh`,
  instalado en `/opt/redunisol-web-prod/apache/` con permiso 755. El hook global
  del cron prevalece sobre el guardado por certificado: este dispatcher usa la
  recarga gradual solo para `prestamos` y delega todos los demas certificados al
  script original de Ferozo, sin cambiar su comportamiento.
- La renovacion usa el cron de Certbot ya existente. No se reemplaza el certificado
  del dominio principal ni se modifica la configuracion de correo.

Para reinstalar el ingreso en esta VPS, subir la configuracion y ambos hooks a
`/opt/redunisol-web-prod/apache/`, emitir el certificado mediante `certbot certonly
--webroot -w /opt/apache/htdocs --cert-name prestamos.redunisol.com.ar
-d prestamos.redunisol.com.ar --deploy-hook
/opt/redunisol-web-prod/apache/renew-prestamos-cert.sh`, instalar el virtual host
en la ruta indicada, ejecutar `/opt/apache/bin/httpd -D SSL -t` y finalmente
`systemctl reload httpd`. El certificado debe existir antes de activar el virtual
host TLS. La cuenta ACME existente se reutiliza desde la configuracion operativa.
Instalar tambien `letsencrypt.cron` en `/etc/cron.d/letsencrypt` con permiso 644,
conservando copia del archivo anterior, y ambos hooks con permiso 755.

Rollback del ingreso: retirar solo `30-prestamos-redunisol.conf`, validar Apache
y recargar `httpd`; conservar el certificado para facilitar la recuperacion.
El rollback de la aplicacion se realiza con las imagenes previas del deploy.

## Validacion

El 17/09/2026 el [deploy de produccion 35222460031](https://github.com/Red-Unisol/redunisol-platform/actions/runs/35222460031)
termino correctamente. PHP-FPM, Nginx y el worker ejecutaban las imagenes
`prod-d82c89f9adcb4822e7063f38ba096deb447e271b` del merge de #362.

Verificacion publica posterior, incluyendo la correccion de dev descrita abajo:

- 188/188 filas de la agencia: HEAD con redirecciones 301 y destino final 200,
  normalizando HTTPS, www y barra final como se define en el mapa.
- 84 paginas (82 destinos y dos landings adicionales), mas una categoria del
  blog: HTML inicial con titulo, description, canonical, Open Graph y Twitter
  unicos, sin marca repetida y consistentes con los datos de Inertia.
- Ocho casos GET: las tres variantes de Cordoba, raiz de prestamos, articulo
  antiguo, privacidad, PDF con espacios y recurso del comodin. Todos terminan
  en 200 y conservan UTM y el identificador de clic codificado.
- Sitemap 200, con 223 URLs y sin los origenes retirados del dominio principal.
- 46 archivos JS/CSS y 78 imagenes sociales responden 200; el bundle publicado
  contiene el encabezado corregido del blog y el enlace a Sobre Nosotros.
- `/health`: base de datos, Redis y storage OK. Los tres contenedores nuevos
  estaban activos, sin reinicios ni errores de servidor en sus logs revisados.

No habia navegador conectado para inspeccion visual de escritorio/movil. Esa
validacion queda separada de las comprobaciones HTTP, HTML y de assets.

### URL historica del entorno dev

El deploy de produccion desde `main` no actualiza el runtime dev, que se publica
desde la rama `dev`. En la verificacion posterior al merge de #362 se detecto
que la fila de empleados UNC en `dev.redunisol.com.ar` seguia devolviendo 404.

Se agrego la misma redireccion exacta del mapa a su virtual host HTTPS, antes
del proxy, en `deploy/apache/dev.redunisol.com.ar.conf`. Este archivo refleja
`/opt/apache/conf.d/22-redunisol-web-dev.conf` de la VPS. Solo esa ruta, con o
sin barra final, responde 301 hacia `https://redunisol.com.ar/`, conservando
la query; las demas rutas siguen en `127.0.0.1:3020`.

La intervencion SSH se realizo dentro de la autorizacion de los ajustes y del
ingreso Apache. Se guardo la copia previa en
`/opt/redunisol-web-prod/apache/dev-before-seo-rule.conf`, se valido la sintaxis
y se recargo Apache. Se verificaron el 301 con UTM y el 200 de las portadas dev
y principal. Para revertir solo esta intervencion, restaurar esa copia, validar
con `/opt/apache/bin/httpd -D SSL -t` y recargar `httpd`.

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
