# Celesol — Resumen de entrega

**Fecha:** 29 de julio de 2026

Este documento resume qué se construyó, qué está funcionando hoy y qué queda pendiente. Es un resumen para lectura no técnica; el detalle técnico para instalar y desplegar el sistema está en el documento complementario `DEPLOY.md` (misma carpeta).

---

## 1. Qué es el sistema

Celesol es la plataforma de gestión de solicitudes de préstamo mutual: cubre desde la carga de una solicitud por un vendedor hasta su liquidación y pago, con evaluación de riesgo, firma y control administrativo en el medio. Se conecta con el sistema legado de Celesol/Vimax para todo lo referido a socios, préstamos y datos históricos.

La entrega consta de **tres repositorios**:

| Repositorio | Contenido |
|---|---|
| `celesol-backend` | API (Node.js/TypeScript), lógica de negocio, base de datos, integración con el legado |
| `celesol-frontend` | Aplicación web (React) usada por vendedores, analistas de riesgo y administradores |
| `celesol-deploy` | Infraestructura de desarrollo local (base de datos, panel de administración de base de datos, almacenamiento de archivos) |

---

## 2. Qué está funcionando hoy

**Flujo completo de solicitudes**, con todos sus estados operativos: Carga por Vendedor → Motor → Revisión de Riesgo → Pre-Aprobada → Confirmada → Verificación de Firma y Documentación → Transferir → Liquidada → Pagada, además de los estados de cierre (Rechazada, Desestimada, Vencida). Cada transición respeta permisos por área (Vendedores, Riesgo, Tesorería) y validaciones de datos obligatorios según el punto del flujo en que se encuentre.

**Gestión de socios**, incluyendo la primera integración que **escribe** en el sistema legado (antes todo era de solo lectura): dar de alta un socio nuevo ahora se registra también en Vimax, para persona física y jurídica, probado en vivo contra el ambiente real.

**Calculadora de riesgo**, integrada dentro del detalle de cada solicitud: de 24 campos que requiere la evaluación, 18 se completan automáticamente con datos reales de la solicitud y del socio; el resto son campos que el analista sigue cargando a mano (por decisión funcional) o que dependen de información que el proveedor del sistema legado todavía no confirmó.

**Simulador de préstamos**, integrado al flujo de alta y edición de solicitudes, incluyendo el cálculo automático de la fecha del primer vencimiento según la línea de crédito elegida.

**Gestión de cancelaciones de préstamos**, módulo completo (alta, edición, baja) conectado a los datos de socios del legado.

**Paneles de control (dashboards)** con estadísticas reales para tres perfiles: Administrador (vista de Operación y vista de Rendimiento), Vendedor y Analista.

**Carga de documentación**, con carga múltiple de archivos y clasificación por tipo (incluye la constancia de CBU como tipo de documento nuevo), y restricción de edad del titular (18 a 85 años).

**Permisos diferenciados**: vendedores no pueden dar de alta socios directamente; administradores pueden ver y editar cualquier solicitud en cualquier estado.


---

## 3. Próximos pasos recomendados

1. Definir sobre qué infraestructura se va a desplegar el sistema en producción (hoy no existe un ambiente de producción propio: solo hay scripts para levantar la base de datos, panel de administración y almacenamiento en una máquina de desarrollo).
2. Seguir los pasos del documento técnico de deploy (`DEPLOY.md`) para poner el sistema en funcionamiento.
