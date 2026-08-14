# Alternativas a MinIO — Guía de referencia

> **Contexto:** El repositorio original `minio/minio` fue archivado el 25 de abril de 2026
> y está en modo read-only. Esta guía documenta las opciones disponibles para reemplazarlo
> en entornos de desarrollo y producción.

---

## Qué pasó con MinIO

| Fecha | Evento |
|---|---|
| Mayo 2025 | La consola web de administración es eliminada de la Community Edition y puesta detrás de una licencia enterprise (~$100 000/año) |
| Diciembre 2025 | El co-fundador declara "maintenance mode": sin features nuevas, sin PRs aceptados |
| Febrero 2026 | Cambia a "no longer maintained"; el repo se archiva brevemente y se reabre |
| 25 abril 2026 | Archivado definitivamente. Sin parches de seguridad garantizados |

Se trata de un **bait-and-switch de licencia** clásico: crecer con open source para capturar adopción y luego forzar a los usuarios hacia enterprise. El código original sigue siendo AGPLv3 y funciona, pero sin mantenimiento activo.

---

## Comparativa rápida

| Proyecto | Lenguaje | Licencia | Madurez | Drop-in S3 | Consola web | Docker simple |
|---|---|---|---|---|---|---|
| **pgsty/minio** | Go | AGPLv3 | Alta (fork de MinIO) | ✔ 100% | ✔ | ✔ |
| **RustFS** | Rust | Apache 2.0 | Baja (beta) | ✔ 100% | ✔ | ✔ |
| **SeaweedFS** | Go | Apache 2.0 | Alta | ✔ (capa S3) | ✔ | Moderado |
| **Garage** | Rust | AGPLv3 | Media-Alta | ✔ parcial | ✗ | ✔ |
| **Ceph RGW** | C++ | LGPLv2 | Muy alta | ✔ 100% | ✔ | Complejo |

---

## 1. pgsty/minio — Fork comunitario

**Repositorio:** https://github.com/pgsty/minio  
**Docker Hub:** `pgsty/minio`  
**Última imagen:** `RELEASE.2026-03-25T00-00-00Z`

### Qué es
Fork mantenido por el equipo de [Pigsty](https://pigsty.io) (distribución PostgreSQL), creado en febrero de 2026 cuando MinIO fue archivado. La intervención fue quirúrgica: revirtieron el submodule de la consola que MinIO había eliminado, reconstruyeron el pipeline de CI/CD y retomaron la distribución de imágenes Docker y paquetes RPM/DEB.

### Ventajas
- **Sustitución literal** del contenedor `minio/minio` — misma API, mismo `mc`, mismas credenciales
- La consola web vuelve a estar incluida sin costo
- Compatibilidad S3 al 100% (hereda todo el código upstream)
- Dashboards de Grafana y reglas de Prometheus incluidas
- Imágenes publicadas con cadencia regular en Docker Hub

### Desventajas
- Mantenido por un equipo pequeño externo a MinIO Inc.; depende de su continuidad
- No hay garantías de parches de seguridad a largo plazo si el equipo pierde interés
- Hereda la licencia AGPLv3 con todas sus implicaciones para software embebido

### Nota
> Es el reemplazo más inmediato y de menor riesgo para cualquier proyecto que ya use MinIO.
> El swap es un cambio de dos caracteres en el `docker-compose.yml`.

### Docker Compose (ejemplo mínimo)
```yaml
minio:
  image: pgsty/minio:RELEASE.2026-03-25T00-00-00Z
  ports:
    - "9000:9000"
    - "9001:9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
  volumes:
    - minio_data:/data
  command: server /data --console-address ":9001"
```

---

## 2. RustFS

**Repositorio:** https://github.com/rustfs/rustfs  
**Docker Hub:** `rustfs/rustfs`  
**Última versión:** `v1.0.0-beta.1` (abril 2026)

### Qué es
Alternativa a MinIO escrita en Rust, publicada bajo Apache 2.0. Surgió directamente como respuesta al cierre de MinIO y apunta a ser el sucesor natural: API S3 completa, consola web, despliegue distribuido y rendimiento superior en objetos pequeños (benchmarks propios muestran 2.3× más throughput que MinIO para payloads de 4 KB).

### Ventajas
- **Apache 2.0** — licencia permisiva, sin restricciones de embedding ni uso comercial
- Rendimiento superior en lecturas/escrituras de objetos pequeños
- Interfaz moderna y activo desarrollo
- Compatible con `mc` (MinIO client) y cualquier SDK de S3
- Potencial a largo plazo como estándar de facto post-MinIO

### Desventajas
- **No production-ready** — `v1.0.0-beta.1` al 30/04/2026; el modo distribuido no tiene release oficial aún
- Ecosistema muy joven: poca documentación de operación, pocos casos de uso documentados en producción
- Sin historial de seguridad ni auditorías conocidas

### Nota
> No usar en producción todavía. Ideal para evaluación, benchmarking o proyectos nuevos
> de desarrollo que puedan aceptar cambios breaking. Vale la pena seguirlo de cerca —
> cuando alcance GA será probablemente la mejor opción por licencia y rendimiento.

### Docker Compose (ejemplo mínimo)
```yaml
rustfs:
  image: rustfs/rustfs:v1.0.0-beta.1
  ports:
    - "9000:9000"
    - "9001:9001"
  environment:
    RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY}
    RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY}
  volumes:
    - rustfs_data:/data
```

---

## 3. SeaweedFS

**Repositorio:** https://github.com/seaweedfs/seaweedfs  
**Docker Hub:** `chrislusf/seaweedfs`  
**Última versión:** `4.22` (activa)

### Qué es
Sistema de almacenamiento distribuido escrito en Go, creado originalmente para almacenar eficientemente miles de millones de archivos pequeños (el problema de escala de Haystack de Facebook, replicado). Expone una capa S3 compatible sobre su arquitectura interna compuesta por nodos master, volume servers y filer.

### Ventajas
- **Apache 2.0**, maduro, con varios años de uso en producción real
- Excelente rendimiento para cargas de trabajo de **muchos archivos pequeños** (imágenes, thumbnails, logs)
- Soporta versioning, lifecycle policies, multipart upload, server-side encryption
- Tiering automático a cloud (S3, GCS, Azure) cuando el disco local se llena
- Activo desarrollo, comunidad grande

### Desventajas
- **No es un drop-in de un solo contenedor**: requiere al minimum un master + un volume server + un filer para habilitar S3 (3 procesos o más)
- La capa S3 es una abstracción sobre su modelo interno; algunos edge cases de S3 pueden diferir
- Curva de aprendizaje más pronunciada: los conceptos de colección, volumen y filer son propios
- Configuración de alta disponibilidad requiere múltiples masters

### Nota
> Mejor opción si el caso de uso principal es almacenar millones de objetos pequeños
> con alta frecuencia de acceso. Para uso sencillo de dev o un bucket de assets,
> la complejidad operativa no justifica el cambio respecto a pgsty/minio.

### Docker Compose (ejemplo mínimo, modo standalone S3)
```yaml
seaweedfs:
  image: chrislusf/seaweedfs:4.22
  ports:
    - "8333:8333"   # S3 API
    - "9333:9333"   # master
    - "8888:8888"   # filer UI
  volumes:
    - seaweedfs_data:/data
  command: >
    server
    -s3
    -dir=/data
    -ip.bind=0.0.0.0
    -master.volumeSizeLimitMB=1024
```

> **Importante:** el puerto S3 es `8333`, no `9000`. Los SDK deben apuntar a `http://localhost:8333`.

---

## 4. Garage

**Repositorio:** https://github.com/deuxfleurs-org/garage  
**Docker Hub:** `dxflrs/garage`  
**Última versión:** `v1.x` (activa)

### Qué es
Motor de almacenamiento de objetos escrito en Rust, diseñado explícitamente para **autohosting geo-distribuido** en entornos con conectividad intermitente o parcial. Nació en el contexto de infraestructura de activistas y cooperativas que necesitaban replicación entre ubicaciones físicas sin depender de cloud. Un nodo completo es un **único binario** configurado con un archivo TOML.

### Ventajas
- Huella extremadamente pequeña: el binario pesa ~20 MB, consume ~50 MB de RAM en idle
- Diseñado para tolerar particiones de red y nodos caídos (CRDTs para metadatos)
- API REST de administración completa, métricas Prometheus integradas
- Puede servir sitios estáticos directamente desde un bucket
- Tres nodos configurados en menos de una hora

### Desventajas
- **S3 parcial**: no implementa ACLs/policies de S3 (tiene su propio modelo de acceso), `GetBucketVersioning` siempre retorna "disabled", sin object locking
- Sin consola web integrada (solo CLI `garage` y API)
- Escala hasta ~50–100 TB; no es adecuado para petabytes
- Comunidad pequeña comparada con SeaweedFS o MinIO

### Nota
> Opción ideal para infraestructura edge, homelab o despliegues distribuidos geográficamente
> con recursos limitados. No recomendado si el código cliente depende de ACLs de S3
> o bucket policies, ya que Garage no las implementa.

### Docker Compose (ejemplo mínimo, modo standalone)
```yaml
garage:
  image: dxflrs/garage:v1.0.0
  ports:
    - "3900:3900"   # S3 API
    - "3901:3901"   # admin API
    - "3902:3902"   # cluster RPC
  volumes:
    - garage_data:/var/lib/garage/data
    - garage_meta:/var/lib/garage/meta
    - ./garage.toml:/etc/garage.toml:ro
```

> **Nota:** Garage requiere un archivo `garage.toml` con el `rpc_secret` y la topología del
> cluster. No arranca sin él. Ver [quickstart oficial](https://garagehq.deuxfleurs.fr/documentation/quick-start/).

---

## 5. Ceph RGW (RADOS Gateway)

**Repositorio:** https://github.com/ceph/ceph  
**Docker Hub:** `quay.io/ceph/ceph`  
**Última versión:** `v19.x` (Squid, activa)

### Qué es
Ceph es un sistema de almacenamiento distribuido que unifica object, block y file storage en una misma plataforma. RADOS Gateway (RGW) es su capa de objeto, compatible con S3 y Swift. Es la solución que usan OpenStack, Kubernetes con Rook, y datacenters privados a escala masiva.

### Ventajas
- **S3 100% compatible**: multipart, versioning, lifecycle, object lock, SSE, bucket policies, ACLs — todo implementado
- Escala a petabytes con erasure coding (FastEC en versiones recientes)
- Altamente battle-tested en producción empresarial
- Integración nativa con Kubernetes vía [Rook](https://rook.io)
- Soporta múltiples protocolos en el mismo cluster (S3, Swift, NFS, CephFS, RBD)

### Desventajas
- **Masivamente sobredimensionado para dev**: un cluster mínimo funcional requiere 3 nodos OSD + monitor + RGW
- El compose de desarrollo consume 2–4 GB de RAM mínimo
- Curva de aprendizaje muy alta; tuning complejo
- Tiempo de bootstrap de un cluster fresco: 10–20 minutos

### Nota
> Solo tiene sentido si ya se usa Ceph para block/file storage en el mismo entorno,
> o si el proyecto va a escalar a decenas de terabytes en producción.
> Para desarrollo local, es overkill absoluto.

---

## Recomendación por caso de uso

| Escenario | Recomendación |
|---|---|
| **Dev local / reemplazar MinIO hoy** | `pgsty/minio` — swap inmediato, sin fricciones |
| **Proyecto nuevo, puede esperar GA** | `RustFS` — seguir de cerca; mejor licencia |
| **Millones de objetos pequeños** | `SeaweedFS` — optimizado para ese patrón |
| **Edge / geo-distribuido / recursos escasos** | `Garage` — diseñado para ese escenario |
| **Producción empresarial / petabytes** | `Ceph RGW` — el estándar de industria |

---

## Estado actual de este proyecto

El `docker-compose.yml` de este repositorio usa actualmente **`minio/minio:RELEASE.2025-09-07T16-13-09Z`**,
que es la última versión del repositorio original antes de ser archivado.

Para migrar a `pgsty/minio` basta con cambiar una línea en `docker-compose.yml`:

```diff
-    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
+    image: pgsty/minio:RELEASE.2026-03-25T00-00-00Z
```

No se requiere ningún otro cambio: volúmenes, puertos, variables de entorno y comandos
son idénticos.
