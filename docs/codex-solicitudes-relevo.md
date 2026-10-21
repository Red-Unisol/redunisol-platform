# Retomar Solicitudes Web en Codex

Guía preparada el **21 de octubre de 2026** para el relevo del 22 de octubre. El estado de ramas y PRs es una referencia fechada: volver a consultarlo al empezar.

## 1. Acceso de la persona que retoma

1. Ingresar a Codex con su propia cuenta autorizada y dentro del espacio de trabajo del equipo, si corresponde.
2. Tener acceso al repositorio privado **Red-Unisol/redunisol-platform**. Leer código y abrir PRs pueden requerir permisos distintos. Si GitHub pide autorización, hacerlo en su interfaz; si falta acceso al repositorio, solicitarlo al administrador de la organización.
3. Crear una tarea y seleccionar ese repositorio y **dev** como rama de referencia. No seleccionar main para Solicitudes.
4. Seleccionar el entorno compartido del proyecto, si está disponible para esa cuenta. Los nombres y la ubicación del selector dependen de la versión de Codex. Si no aparece, pedir al administrador que lo comparta o crear un entorno nuevo con el mismo repositorio y las instrucciones de esta guía.
5. Esperar que termine el inicio del entorno. Pedir a Codex que compruebe acceso al checkout, rama y GitHub antes de editar.

No hace falta acceso a esta conversación para recuperar los cambios ya enviados a GitHub. Una tarea nueva puede crear otra máquina: el código se recupera de Git; los procesos, la sesión web, los recibos subidos y los archivos locales privados no se transfieren necesariamente. El entorno compartido también debe estar permitido para esa persona; conocer su nombre o tener acceso a GitHub no concede acceso a la máquina anterior.

## 2. Qué rama elegir

| Trabajo | Rama / referencia | Estado comprobado el 21/10/2026 |
| --- | --- | --- |
| Trabajo nuevo de Solicitudes | dev | Referencia revisada: `3b6214735c2f97ab4419861d0dc9daf40a6f9fde` |
| Retomar sincronización de Recientes y vistas por área | feat/recientes-sincronizacion-vistas — [PR #559](https://github.com/Red-Unisol/redunisol-platform/pull/559) | Borrador abierto; commit `3f2857ce1f7a9e9b686eb1aeec6f5176916e5517`; sin despliegue realizado por esta tarea |
| Diseño de extracción y pop-up de descuentos | docs/recibos-a-evaluacion-propuesta — [PR #514](https://github.com/Red-Unisol/redunisol-platform/pull/514) | Borrador de documentación; no implementa la extracción ni la carga en calculadora |

El cambio de Recientes consulta cada 15 segundos, ofrece Vendedores / Analistas / Todas al vendedor y conserva permisos y ventana de 21 días. Si el PR #559 sigue abierto, seleccionar su rama para continuar ese trabajo. Si ya se mergeó, revisar el dev actual. No recrear el cambio ni mergearlo automáticamente para preparar el entorno.

El pop-up sigue separado. La revisión de AMEJUCA no autoriza cambiar su plantilla, sus códigos ni sus fórmulas. Tesorería y los demás pendientes anteriores requieren revisar su alcance antes de retomarlos.

Esta guía se publica en la rama docs/codex-solicitudes-relevo. Mientras su PR esté pendiente, puede leerse desde GitHub aunque el archivo todavía no exista en dev ni en la rama del PR #559. El mensaje siguiente es utilizable por sí mismo.

## 3. Mensaje listo para pegar en una nueva tarea

> Retomá Solicitudes Web de Red-Unisol/redunisol-platform. La referencia es dev, no main. Leé AGENTS.md, web/AGENTS.md y, si ya existe en la rama elegida, docs/codex-solicitudes-relevo.md. Revisá git status y preservá cambios, archivos locales y commits existentes. Comprobá el acceso a GitHub y el estado actual del PR #559. Si continúa abierto, retomá feat/recientes-sincronizacion-vistas; si está mergeado, revisá dev. Prepará las dependencias con los lockfiles, generá Prisma y ejecutá las comprobaciones locales indicadas. No crees worktrees salvo pedido explícito: cada tarea cloud ya está aislada. El PR #514 contiene solo el diseño del pop-up, sin implementación. Informá rama, commit, resultados y pendientes. No despliegues, mergees PRs, ejecutes migraciones/seeds ni modifiques solicitudes reales para preparar el entorno.

## 4. Comprobación inicial para Codex

La ruta del checkout de esta sesión es `/workspace/redunisol-platform`. En otra máquina puede variar; comprobarla antes de ejecutar comandos. No clonar encima de un checkout existente.

Desde la raíz:

```bash
pwd
git status --short --branch
git log -1 --format='%H %s'
git ls-remote origin refs/heads/dev refs/heads/feat/recientes-sincronizacion-vistas
gh pr view 559 --json number,state,isDraft,headRefName,headRefOid,baseRefName,url
```

Leer `AGENTS.md`, `web/AGENTS.md`, `docs/agent-systems.md`, los README de frontend/backend y la documentación de despliegue antes de tocar esos circuitos. No imprimir el contenido de `.env`, `credentials.txt` ni variables con secretos.

Si Git funciona pero `gh` falla, distinguir permisos de Git y API; no pedir un token por chat. En este entorno la autenticación de GitHub puede estar suministrada por el proxy de Codex aunque no haya `GH_TOKEN` visible.

Antes de cambiar de rama, comprobar que no se pisan cambios. Para una tarea nueva, con el checkout limpio:

```bash
git fetch origin dev
git switch -c feat/nombre-de-la-tarea FETCH_HEAD
```

Para continuar el PR #559, preferir seleccionar su rama al crear la tarea. Si ya existe localmente y el estado permite cambiar:

```bash
git switch feat/recientes-sincronizacion-vistas
```

Si no existe localmente, comprobar primero el remoto y traer esa rama de forma explícita. No hacer `reset --hard`, `clean`, force-push ni descartar cambios para resolver diferencias. Una copia local de `origin/dev` puede estar desactualizada: comprobar el SHA obtenido por fetch. No actualizar ni mezclar ramas del usuario automáticamente.

## 5. Preparar herramientas y dependencias

Flujo mínimo: editar, compilar y ejecutar pruebas locales de consultas, permisos y caché. **No requiere arrancar la API, Postgres, MinIO ni llamar a Mistral.**

Usar Node **22.12 o superior dentro de la serie 22**, o una serie compatible posterior como Node 24. Entorno comprobado: Node `24.19.0` y npm `11.9.0`. El despliegue utiliza imágenes Node 22. Conservar los package-lock y las versiones del proyecto.

```bash
cd /workspace/redunisol-platform
node --version
npm --version

cd web/solicitudes-web/celesol-backend
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:generate

cd ../celesol-frontend
npm ci --ignore-scripts --no-audit --no-fund
```

Se sigue la instalación con lockfiles usada por los Dockerfiles; se genera Prisma explícitamente. `prisma:generate` genera el cliente local: no equivale a aplicar migraciones. Si faltan tipos de Prisma después de cambiar de rama, repetir esa generación.

No copiar `.env` de otra persona ni usar los archivos de dev/producción para arrancar pruebas locales. Los `.env.example` describen variables, no son una configuración operativa compartida. Para las comprobaciones seleccionadas no hace falta una clave Mistral ni acceso a la base real.

## 6. Comprobaciones del PR #559

Ejecutar esta sección en la rama del PR, o en dev solamente si ya contiene el cambio. Sus archivos nuevos no están en un dev anterior al merge.

Backend:

```bash
cd /workspace/redunisol-platform/web/solicitudes-web/celesol-backend
npm run typecheck
node_modules/.bin/tsx --test \
  src/modules/solicitudes-core/application/use-cases/ListSolicitudes.use-case.test.ts \
  src/modules/solicitudes-core/infrastructure/datasources/SolicitudesCorePrismaDatasource.test.ts \
  src/modules/solicitudes-core/presentation/SolicitudesCoreController.test.ts
```

Frontend:

```bash
cd /workspace/redunisol-platform/web/solicitudes-web/celesol-frontend
VITE_API_BASE_URL=http://127.0.0.1:3001 npm run build
../celesol-backend/node_modules/.bin/tsx --test \
  src/modules/solicitudes-core/utils/recientes*.test.ts \
  src/modules/solicitudes-core/utils/list-refresh-state.test.ts
```

Finalmente, desde la raíz, `git diff --check` y `git status --short --branch`. Ejecutar lint sobre los archivos modificados por la tarea, según su proyecto. El script npm test de frontend no representa toda la cobertura de Recientes: usar la selección explícita anterior.

En el commit del PR indicado arriba pasaron **104 pruebas de backend y 17 de frontend**, tipos, build y lint de los archivos modificados. Los observadores usan React Query real con transporte simulado; el datasource usa un cliente Prisma simulado. No son pruebas contra la base de dev ni sustituyen la revisión visual y el seguimiento con dos sesiones. Los avisos de chunks grandes y eval de una dependencia Excel no impidieron el build.

## 7. Arranque visual opcional

Solo si la tarea necesita el servidor de interfaz:

```bash
cd /workspace/redunisol-platform/web/solicitudes-web/celesol-frontend
VITE_API_BASE_URL=http://127.0.0.1:3001 npm run dev -- --host 127.0.0.1 --port 5199 --strictPort
```

Mantener ese proceso en su terminal. Una respuesta HTTP 200 de Vite comprueba que sirve la interfaz, no que funcionen login, API, documentos o base de datos. Sin API local, esos circuitos no estarán operativos. Para revisar el servidor desde otra terminal se puede usar `curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/`.

Levantar el backend completo es una preparación adicional: requiere una base local aislada, almacenamiento y configuración coherente con el README. No se deja preparado por esta guía. No apuntar la interfaz local ni sus pruebas al backend de dev sin revisar el alcance de las operaciones.

Para observar el sistema ya publicado, usar la propia sesión autorizada en `https://solicitudes-dev.redunisol.com.ar`. Esa sesión es distinta de la cuenta de Codex y de GitHub. Para integraciones reales, pedir a un administrador las vinculaciones seguras necesarias: `MISTRAL_API_KEY` pertenece al backend; `SOLICITUDES_MISTRAL_API_KEY` es el secreto dedicado del despliegue de GitHub Actions. No se necesita su valor para este relevo de código ni debe copiarse al prompt.

## 8. Si el entorno vuelve a quedar sin conexión

1. Pedir a Codex que pruebe un comando mínimo (`pwd`) y consulte el estado del entorno, si dispone de esa herramienta.
2. Si está iniciando, esperar su finalización. Si está offline y no acepta comandos, no diagnosticarlo como un fallo de GitHub ni del sitio de Solicitudes.
3. Recargar Codex y abrir la tarea. Si la interfaz ofrece iniciar/reanudar/reiniciar, usar la opción disponible; no todos los clientes muestran los mismos controles.
4. Si persiste, crear una tarea nueva con el repositorio y rama correspondientes y pegar el mensaje de esta guía. Si tampoco inicia, enviar a soporte del entorno el estado y la hora, sin secretos.
5. No reiniciar la VPS ni volver a cargar claves como solución al fallo de la máquina de Codex. No se identificó la causa del incidente anterior.

## 9. Qué conservar y entregar al siguiente relevo

GitHub conserva el código enviado y los PRs. Preservar también los cambios locales del usuario antes de cambiar de máquina. En la sesión original existía `web/var/` sin seguimiento: no borrarlo ni incluirlo en commits por inercia.

No compartir copias de `.env`, claves ni recibos personales para reproducir dependencias. Los archivos de prueba privados se aportan por un canal autorizado cuando una prueba concreta los necesita. Los procesos deben arrancarse de nuevo: una publicación del entorno no conserva procesos vivos.

Dejar un breve estado con rama, SHA, PR, pruebas ejecutadas, fallos y último despliegue efectivamente comprobado. No inferir que un merge prueba un despliegue ni que un build prueba el comportamiento publicado. Al crear/actualizar un PR, no esperar ni monitorizar los checks remotos: informar que quedan pendientes conforme a AGENTS.md.

Las instrucciones guardadas en la configuración del entorno son un borrador hasta que el responsable las revise, guarde y publique desde la configuración de Codex cuando corresponda. Guardarlas no despliega Solicitudes ni concede acceso a otra persona. Su restauración en una tarea nueva debe comprobarse por separado.
