# Redunisol Web Production Cutover

Este runbook cubre la migracion final de la web publica desde `redunisol.com.ar` hacia la VPS que ya sirve `dev.redunisol.com.ar`, manteniendo el servicio de mail en la VPS anterior.

## Estado DNS Verificado

Verificado el 2026-06-01:

- `dev.redunisol.com.ar` resuelve a `66.97.34.158`
- `redunisol.com.ar` resuelve a `66.97.38.50`
- `www.redunisol.com.ar` es `CNAME` de `redunisol.com.ar`
- `mail.redunisol.com.ar` resuelve a `66.97.38.50`
- `mx1.redunisol.com.ar` resuelve a `200.58.122.206`
- MX de `redunisol.com.ar`:
  - prioridad `0`: `mail.redunisol.com.ar`
  - prioridad `20`: `mx1.redunisol.com.ar`
- `autodiscover.redunisol.com.ar` es `CNAME` de `redunisol.com.ar`
- `autoconfig.redunisol.com.ar` es `CNAME` de `redunisol.com.ar`

## Objetivo De Corte

Publicar la web en:

- `https://redunisol.com.ar`
- `https://www.redunisol.com.ar`

Mantener mail en:

- `mail.redunisol.com.ar` -> `66.97.38.50`

## Registros DNS Esperados Post Corte

```text
redunisol.com.ar              A      66.97.34.158
www.redunisol.com.ar          CNAME  redunisol.com.ar
mail.redunisol.com.ar         A      66.97.38.50
autodiscover.redunisol.com.ar CNAME  mail.redunisol.com.ar
autoconfig.redunisol.com.ar   CNAME  mail.redunisol.com.ar
```

Los registros MX deben conservarse:

```text
redunisol.com.ar MX 0  mail.redunisol.com.ar
redunisol.com.ar MX 20 mx1.redunisol.com.ar
```

No cambiar SPF, DKIM ni DMARC como parte del corte web.

## Preparacion En Repo

El runtime prod esperado usa:

- `TARGET_DIR=/opt/redunisol-web-prod`
- `WEB_BIND=127.0.0.1:3021:80`
- `APP_URL=https://redunisol.com.ar`
- `SESSION_DOMAIN=redunisol.com.ar`

Antes del deploy prod debe existir el env cifrado que consume el workflow:

- `web/redunisol-web/deploy/redunisol-web.prod.env.enc`

Creado el 2026-06-01 a partir del env cifrado de dev, reutilizando sus valores operativos y ajustando solo:

- `TARGET_DIR=/opt/redunisol-web-prod`
- `WEB_BIND=127.0.0.1:3021:80`
- `APP_ENV=production`
- `APP_DEBUG=false`
- `APP_URL=https://redunisol.com.ar`
- `SESSION_DOMAIN=redunisol.com.ar`

## Reverse Proxy

En la VPS nueva, Apache debe publicar `redunisol.com.ar` y `www.redunisol.com.ar` contra el bind interno de prod:

```text
http://127.0.0.1:3021/
```

`dev.redunisol.com.ar` debe seguir apuntando a:

```text
http://127.0.0.1:3020/
```

## Certificados

Emitir o renovar certificado web para:

```text
redunisol.com.ar
www.redunisol.com.ar
```

El certificado de mail queda fuera de este corte y debe seguir administrado en la VPS anterior.

## Orden Seguro De Ejecucion

1. Bajar TTL de `redunisol.com.ar`, `www`, `autodiscover` y `autoconfig` si el panel DNS lo permite.
2. Ejecutar deploy prod manual desde `main`.
3. Validar en la VPS nueva con `Host: redunisol.com.ar` contra `127.0.0.1:3021`.
4. Configurar Apache para `redunisol.com.ar` y `www.redunisol.com.ar`.
5. Emitir certificado TLS para `redunisol.com.ar` y `www.redunisol.com.ar`.
6. Cambiar DNS publico de `redunisol.com.ar` a `66.97.34.158`.
7. Cambiar `autodiscover` y `autoconfig` para que apunten a `mail.redunisol.com.ar`.
8. Validar web, formularios, cookies, assets y mail.

## Validaciones Post Corte

```bash
curl -I https://redunisol.com.ar/
curl -I https://www.redunisol.com.ar/
curl -I http://redunisol.com.ar/
dig +short redunisol.com.ar A
dig +short mail.redunisol.com.ar A
dig +short redunisol.com.ar MX
```

Resultados esperados:

- `https://redunisol.com.ar/` responde `200`
- `https://www.redunisol.com.ar/` responde o redirige correctamente
- `http://redunisol.com.ar/` redirige a HTTPS
- `redunisol.com.ar` resuelve a `66.97.34.158`
- `mail.redunisol.com.ar` sigue resolviendo a `66.97.38.50`
- MX sigue apuntando a `mail.redunisol.com.ar` y `mx1.redunisol.com.ar`

## Rollback

Si falla la publicacion web, revertir:

```text
redunisol.com.ar A 66.97.38.50
```

Mantener sin cambios:

```text
mail.redunisol.com.ar A 66.97.38.50
MX redunisol.com.ar mail.redunisol.com.ar
MX redunisol.com.ar mx1.redunisol.com.ar
```
