# AGENTS.md

Git es la fuente de verdad de Kestra; la UI es solo runtime y observacion.

- Automatizaciones de negocio: `automations/<dominio>/`.
- Plataforma compartida: `platform/`.
- Herramientas de validacion y deploy: `tools/`.
- Leer la documentacion del dominio antes de modificar un flow o namespace file.
- El namespace escrito en el YAML no es necesariamente el namespace final: el deploy lo adapta por ambiente.
- Si se agrega un dominio, revisar deploy, workflows, CODEOWNERS, tests y documentacion.
- Ejecutar `python kestra/tools/validate_kestra.py` y las pruebas del dominio afectado.
- No editar secretos, flows o archivos persistentes directamente en la UI como solucion definitiva.
- Para estado actual, consultar Kestra; no asumir que un checkpoint documentado sigue vigente.
