# AGENTS.md

## Objetivo

Esta monorepo es la fuente de verdad Git para las automatizaciones, aplicaciones y sitios de Red Unisol.

- repositorio: `Red-Unisol/redunisol-platform`
- rama principal: `main`
- Kestra y las VPS son runtimes; no son la fuente de verdad del codigo

## Antes de trabajar

1. Ejecutar `git status --short --branch` y preservar cambios ajenos.
2. Leer el `AGENTS.md` mas cercano al archivo que se va a tocar.
3. Identificar primero el sistema y la fuente de datos correctos en `docs/agent-systems.md`.
4. Para accesos operativos, consultar `credentials.txt` antes de concluir que falta acceso.

En busquedas normales excluir `.tmp/`, `temp/`, `tmp/`, `untracked/`, `.local/`, `.local-secrets/`, dependencias y artefactos compilados. Esas carpetas no son fuentes canonicas y pueden contener copias historicas.

## Forma de trabajo

- Para pedidos de investigacion o diagnostico: observar y explicar; no modificar sin pedido.
- Para pedidos de cambio: avanzar con autonomia, implementar, probar y entregar el resultado. Evitar planeamiento extenso.
- Para PRs o cambios aislados: usar una rama y, si hay trabajo local que preservar, un worktree separado.
- No mezclar correcciones no relacionadas en el mismo PR.
- Antes de afirmar que algo no es accesible, revisar `credentials.txt`, herramientas disponibles, CLI autenticadas y alternativas documentadas.
- Para SSH, usar el bloque y comando exactos de `credentials.txt`; no asumir puerto `22`, usuario ni metodo de autenticacion.
- Preferir la fuente primaria del sistema. Un Excel o informe suele ser una salida derivada, no la fuente de datos.
- Verificar el resultado real cuando sea posible: tests, workflow, API, runtime o pagina publicada. Un workflow rojo no demuestra por si solo que el deploy funcional fallo.
- Al abrir o actualizar un PR, ejecutar las validaciones locales pertinentes pero no esperar ni monitorear los checks remotos. Informar que quedaron pendientes; el usuario avisara si alguno falla.

## Accesos y secretos

`credentials.txt`, en la raiz, es el archivo local canonico de accesos para agentes y operadores. Puede contener usuarios, contrasenas, tokens, claves privadas y notas de conexion.

- esta ignorado por Git y nunca debe agregarse, imprimirse, citarse ni copiarse a documentacion traqueada
- leer solo la seccion necesaria para la tarea
- no mostrar valores secretos en comandos, logs, comentarios, commits o respuestas
- los `.env` operativos pueden seguir existiendo como copias requeridas por los runtimes; para descubrir un acceso, empezar por `credentials.txt`

## Fuentes de orientacion

- `docs/agent-systems.md`: mapa de sistemas, accesos y fuentes de verdad
- `docs/README.md`: indice de documentacion transversal
- `docs/architecture.md`: arquitectura general
- `docs/ci-cd.md`: validacion y despliegues
- `docs/kestra-configuration.md`: configuracion de Kestra
- `.vscode/tasks.json`: tareas operativas locales existentes

Los checkpoints con fecha son evidencia historica, no garantia del estado actual. Para conocer el estado presente, verificarlo en el sistema correspondiente.

## Limites

- No editar flows o namespace files persistentemente desde la UI de Kestra.
- No tocar endpoints historicos, produccion, DNS, VPS o datos externos sin que el pedido los incluya.
- No asumir que un webhook de Bitrix puede comentar tareas: chat de tarea, comentario REST y chat de proyecto son destinos distintos.
- AWS no forma parte del camino operativo normal; tratar cualquier uso futuro como una tarea explicita y aislada.
