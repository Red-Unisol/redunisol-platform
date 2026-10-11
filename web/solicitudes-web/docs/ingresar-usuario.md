# Ingresar usuario

Solo `isSystemAdmin` permite iniciar el acceso. El destino debe estar activo
(`state = 1`) y tener `workflowOwnerId`. No se modifican contraseñas, áreas ni
permisos de las cuentas. Se rechazan el propio usuario y los accesos encadenados.

Las cookies de autenticación siguen identificando al administrador. La cookie
HttpOnly `actingSession` referencia un contexto persistido en el servidor y
vinculado a ese administrador. Cada petición valida ambas cuentas y utiliza
AsyncLocalStorage para que GetCurrentUser devuelva exclusivamente el perfil
seleccionado. La renovación conserva los tokens del administrador y devuelve al
cliente la identidad efectiva. El regreso puede utilizar un refresh válido si
venció el access token; el cierre de sesión termina el acceso y revoca la sesión.

La fecha límite del contexto es la del refresh token al iniciar. El marcador es
una cookie de sesión: al vencer el contexto, el servidor bloquea las operaciones
hasta regresar, sin restaurar privilegios administrativos silenciosamente.

El frontend muestra ambas identidades y el regreso en un banner global. Entrar,
regresar o cerrar sesión cancela y limpia consultas y recarga el documento. Un
evento de almacenamiento avisa a otras pestañas del mismo origen.

## Auditoría

La migración `20261011190000_impersonation` agrega tablas de sesiones y operaciones,
y tres columnas opcionales al historial de solicitudes. Conserva registros
anteriores. El entrypoint habitual aplica la migración al arrancar el backend.

`impersonation_operations` registra inicio, finalización y peticiones con ambas
identidades, método/ruta, fecha y resultado HTTP. Se persiste el intento antes de
operar; el resultado se completa al finalizar la respuesta. No se guardan cuerpos,
contraseñas ni tokens. Un resultado sin completar representa un intento cuyo
resultado no pudo registrarse, no una operación exitosa. El historial de estados
y asignaciones enlaza administrador, sesión y operación. No se agrega una pantalla
de auditoría en este cambio.

## Verificación

- Suite backend: 1007 pruebas aprobadas y 2 omitidas opcionales.
- Suite frontend ejecutada con el runner TypeScript: 94 aprobadas.
- Compilación de ambos proyectos.
- Integración con PostgreSQL local: autorización, elegibilidad, permisos efectivos,
  auditoría, contexto inválido, renovación, regreso, cierre y bloqueo de cadenas.
- Navegador con API simulada: inicio, banner, área seleccionada, recarga, regreso,
  limpieza de caché y sincronización entre pestañas.

La prueba de navegador utiliza usuarios ficticios; no sustituye la comprobación
manual con cuentas reales en dev. La vista HTML externa al repositorio es una
simulación del recorrido y no forma parte de la aplicación desplegada.
