# Redunisol Web Operating Model

Este documento fija el modelo operativo para `web/redunisol-web/` bajo escenario B.

## Decision Base

`redunisol-web` no va a usar Git como unica fuente de verdad total.

Se adopta este criterio:

- Git define codigo, infraestructura, build, deploy y configuracion declarativa
- la base de datos y el storage de la aplicacion guardan el estado mutable de negocio
- el panel admin forma parte del runtime normal de la aplicacion

## Que Define Git

Git sigue siendo la fuente de verdad para estos elementos:

- codigo Laravel, React, Inertia y Filament
- Dockerfiles, compose y manifiestos de despliegue
- configuracion base de runtime versionable
- migrations, seeders y defaults de aplicacion
- workflows de CI/CD
- configuracion de reverse proxy y publicacion
- politicas de despliegue entre `dev` y `prod`

En particular, el criterio esperado es alinearlo con el modelo ya usado en `kestra/` y `web/herramientas/`:

- `main` despliega automaticamente a `dev`
- `prod` se promueve con accion manual explicita
- el servidor corre artefactos construidos desde Git
- no se usa el servidor como lugar normal de cambios manuales persistentes

## Que No Define Git

Git no es la fuente de verdad para estos elementos runtime:

- contenido creado o editado desde Filament
- registros de negocio en PostgreSQL
- usuarios, sesiones, tokens y preferencias runtime
- cola, cache y estado de Redis
- archivos subidos por usuarios o por el panel admin

Estos datos deben tratarse como estado operativo del sistema.

## Consecuencias Practicas

Este modelo implica estas reglas:

- no editar codigo dentro del contenedor o del servidor como flujo normal
- no usar cambios manuales en la VPS como forma de configurar la aplicacion
- no usar el panel admin para reemplazar configuracion que deberia vivir en Git
- si cambia el schema, se cambia por migration versionada
- si cambia un default funcional, se cambia en codigo o seed versionado
- si cambia infraestructura, se cambia en Git y se redepliega

## Runtime Configuration

La configuracion sensible o dependiente de ambiente no debe vivir en texto plano dentro del repo.

Modelo esperado:

- archivo editable local `.env`
- archivo versionado cifrado `.env.enc`
- clave de cifrado fuera de Git
- secretos operativos en el environment compartido `vps-infra`

GitHub Actions se usa como mecanismo de ejecucion, no como fuente primaria de configuracion funcional.

## Storage Y Persistencia

Como el panel admin va a estar activo, hay que asumir persistencia real fuera del contenedor.

Minimo esperado:

- PostgreSQL con volumen persistente
- storage de Laravel persistente para uploads o assets generados
- estrategia de backup para base de datos y archivos

Si algun contenido del panel necesita promotion controlada entre ambientes, no debe resolverse a mano. Hay que definir uno de estos caminos:

- seeds o importadores versionados en Git
- export/import controlado por proceso operativo
- integracion con almacenamiento externo o CMS dedicado

## Modelo De Ambientes

Se mantiene el mismo principio general que en el resto de la repo:

- `dev`: ambiente de integracion continuo desde `main`
- `prod`: ambiente estable con deploy manual

`dev` puede aceptar reset o reprovision controlado.

`prod` no debe depender de rebuilds manuales ad hoc ni de cambios aplicados directamente en servidor.

## Limites Del Panel Admin

Filament se considera parte del producto, no de la infraestructura.

Por eso:

- el panel puede administrar contenido y datos operativos
- el panel no deberia administrar secretos, compose, proxy, rutas publicas o configuracion de despliegue
- cualquier ajuste de infraestructura debe seguir entrando por Git

## Resultado Esperado

El resultado buscado para `redunisol-web` es este:

- infraestructura Git-managed
- despliegue reproducible
- runtime con estado persistente fuera del contenedor
- panel admin habilitado para contenido y operacion
- separacion clara entre configuracion declarativa e informacion mutable