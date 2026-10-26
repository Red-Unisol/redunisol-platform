# Beex UI Lab

Entorno local para revisar pantallas y estados con datos ficticios y componentes reales.
Está separado del frontend operativo: no cambia su ruta de entrada, configuración Vite,
build ni lógica financiera. Las variantes son prototipos; no ejecutan operaciones reales.

## Uso

Desde `web/solicitudes-web/celesol-frontend`, con las dependencias habituales instaladas:

- `npm run ui:dev`: abre el servidor en http://127.0.0.1:5271 (sólo loopback).
- `npm run ui:check`: verifica TypeScript del lab y los componentes que importa.
- `npm run ui:test`: prueba el bloqueo de red y los fixtures.
- `npm run ui:build`: construye el lab en `.local/ui-lab-dist`, fuera del build operativo.
- `npm run ui:preview`: sirve ese build en el mismo puerto local.

No necesita backend, PostgreSQL, credenciales ni un servidor Python adicional.
El workflow Validate ejecuta las pruebas y el build del lab en un paso separado del frontend operativo.
Si el puerto 5271 está ocupado, el comando falla para evitar tomar otro puerto en silencio.
Los comandos normales `npm run dev`, `npm run build` y `npm run preview` conservan su función.

## Fixtures y red

`bootstrap.tsx` instala el transporte de fixtures **antes** de importar la aplicación.
El origen API es una constante del lab; Vite no carga archivos `.env` operativos.
El guard sólo acepta los GET de revisión de préstamo y cancelaciones para la solicitud
ficticia exportada como `UI_LAB_SOLICITUD_ID`. Cualquier POST, ruta no prevista u origen
externo falla localmente; nunca se invoca el `fetch` anterior. No usar datos de clientes.
La política CSP permite recursos del mismo servidor y su websocket de recarga, y bloquea
conexiones a APIs externas, iframes y envíos de formularios.

Para incorporar un componente nuevo que consulte API, agregar primero su fixture explícito
y una prueba de que rutas no previstas siguen bloqueadas. No agregar una salida a la red real.

## Proceso de trabajo

1. Definir escenario y datos ficticios en `scenarios.ts`, incluyendo permisos y condiciones.
2. Maquetar con componentes compartidos y cubrir estado inicial, carga, error y éxito.
3. Revisar visualmente textos, jerarquía, tamaños y recuperación ante errores; guardar evidencia
   cuando ayude a comparar alternativas.
4. Integrar la API real después de validar la interacción, dentro del alcance ya autorizado.
5. Validar la integración en un ambiente controlado antes de su publicación.

La revisión visual no introduce una aprobación adicional cuando el trabajo ya está autorizado.
El proceso general se documenta en [prototipado de UI](../../../../docs/ui-prototyping.md).
