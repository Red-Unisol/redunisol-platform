# Docs

Documentacion tecnica transversal de la repo.

## Documentos actuales

- `architecture.md`: arquitectura general, capas, carpetas y modelo dominio/namespace
- `ci-cd.md`: validacion, deploy, workflows y promocion entre ambientes
- `kestra-configuration.md`: catalogo de variables y secretos, convenciones y alta de configuracion nueva
- `migration-notes.md`: contexto historico de la migracion inicial a la monorepo

## Cuando agregar un documento nuevo

Agregar documentacion nueva cuando haga falta dejar registrado alguno de estos puntos:

- arquitectura o decisiones de estructura del repo
- comportamiento de CI/CD o deploy
- convenciones transversales
- configuracion compartida entre dominios
- runbooks operativos o troubleshooting

## Lo que no deberia vivir aca

- documentacion especifica de un dominio particular: va en `automations/<dominio>/docs/`
- contratos de integracion que pertenecen a un dominio puntual: van con ese dominio
- notas historicas operativas externas a la monorepo: van fuera de esta carpeta