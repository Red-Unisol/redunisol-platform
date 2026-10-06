# AGENTS.md

Cada carpeta bajo `apps/` es una aplicacion independiente.

- Identificar primero su README, stack, configuracion y comandos propios.
- No asumir que comparte dependencias, deploy o variables con otra app del monorepo.
- Mantener secretos fuera de Git y usar `credentials.txt` para descubrir accesos operativos.
- Preservar los `.env` locales que el runtime o la aplicacion consumen.
- Ejecutar las pruebas y el build de la aplicacion afectada, no comandos globales indiscriminados.
- Separar cambios de aplicaciones diferentes en ramas o PRs distintos.
