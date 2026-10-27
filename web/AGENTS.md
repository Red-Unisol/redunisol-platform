# AGENTS.md

Cada carpeta bajo `web/` es un sitio o herramienta independiente.

- Leer su README y documentacion de deploy antes de cambiarlo.
- No asumir que todos los sitios usan el mismo framework, build o runtime.
- Mantener configuracion y secretos de ambiente fuera de Git; consultar `credentials.txt` para accesos.
- Para cambios publicos, validar tests, build y comportamiento publicado cuando el pedido incluya deploy.
- Distinguir HTML inicial, comportamiento del cliente y estado del backend al diagnosticar una pagina.
- No mezclar cambios de sitios distintos en el mismo PR.
- Para cambios de UI, levantar la interfaz localmente y revisar el resultado renderizado antes de entregar. Mantener escenarios reproducibles con datos ficticios, probar escritorio y un viewport angosto real, y adjuntar capturas cuando se comparen diseños. En Beex, reutilizar `celesol-frontend/ui-lab/` y consultar `docs/ui-prototyping.md`; no usar producción como banco de pruebas de maquetado.
