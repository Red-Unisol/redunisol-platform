# AGENTS.md

Cada carpeta bajo `web/` es un sitio o herramienta independiente.

- Leer su README y documentacion de deploy antes de cambiarlo.
- No asumir que todos los sitios usan el mismo framework, build o runtime.
- Mantener configuracion y secretos de ambiente fuera de Git; consultar `credentials.txt` para accesos.
- Para cambios publicos, validar tests, build y comportamiento publicado cuando el pedido incluya deploy.
- Distinguir HTML inicial, comportamiento del cliente y estado del backend al diagnosticar una pagina.
- No mezclar cambios de sitios distintos en el mismo PR.
