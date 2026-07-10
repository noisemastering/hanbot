# Propuesta de Costos — Sistema HanlobBot

**Preparado para:** Hanlob
**Fecha:** Junio 2026

---

## Resumen

Este documento detalla los costos mensuales para mantener el sistema HanlobBot en operación tras la entrega del proyecto. Los costos se dividen en dos rubros:

1. **Costos de operación** — servicios de infraestructura y plataformas, transferidos al cliente a su costo real (sin margen).
2. **Cuota de mantenimiento** — el servicio de soporte y actualización continua del sistema.

Adicionalmente se detalla la **garantía sin costo** incluida en la entrega.

---

## 1. Costos de operación (al costo, transferidos al cliente)

Estos son los servicios externos que mantienen el sistema funcionando. Se facturan a su costo real, sin recargo.

| Servicio | Función | Mensual (USD) |
|---|---|---|
| **OpenAI API** | Motor de inteligencia artificial del bot (genera todas las respuestas) | $60 |
| **Vercel** | Hospedaje del panel de administración (tier comercial) | $20 |
| **Railway** | Hospedaje del servidor del bot | $10 |
| **MongoDB Atlas** | Base de datos | $0 (tier gratuito) |
| **Cloudinary / Meta / Mercado Libre** | Imágenes, Messenger/WhatsApp, órdenes | $0 |
| **Dominios** (agente / panel .hanlob) | Renovación (prorrateado) | ~$2 |
| | **Subtotal de operación** | **≈ $92 / mes** |

### Nota sobre la base de datos
Actualmente la base de datos usa aproximadamente el **25% del tier gratuito** (127 MB de 512 MB disponibles). Al ritmo de crecimiento actual, el tier gratuito es suficiente por **2 años o más**. Solo será necesario migrar a un tier de paga (entre $9 y $57/mes) si los datos superan ~400 MB o si la revisión de datos a un año requiere mayor capacidad de cómputo. **Se señala desde ahora para que no sea una sorpresa a futuro.**

---

## 2. Cuota de mantenimiento (servicio)

Servicio de soporte y mantenimiento continuo del sistema. **Tiempo de respuesta: siguiente día hábil.**

### ¿Qué incluye?
- Renovación de credenciales de Mercado Libre (caducan periódicamente).
- Migraciones por cambios de versión en las APIs de Facebook y Mercado Libre.
- Actualizaciones de dependencias y parches de seguridad.
- Monitoreo de disponibilidad (uptime) y gestión de despliegues.
- Respaldos de la base de datos.
- Actualizaciones de catálogo, precios y contenido.
- Solicitudes de cambios menores fuera del alcance de la garantía.

### Estructura
Herramienta de desarrollo asistido (Claude Code) **$50/mes** + mano de obra **$35 USD/hora**. Horas excedentes se facturan a $35 USD/hora.

| Plan | Mano de obra incluida | Cuota mensual (USD) |
|---|---|---|
| **Ligero** | 2 hrs/mes | **$120** |
| **Estándar** | 4 hrs/mes | **$190** |

---

## 3. Total mensual para el cliente

| Escenario | Operación | Mantenimiento | **Total mensual** |
|---|---|---|---|
| **Con plan Ligero** | $92 | $120 | **≈ $212 USD** |
| **Con plan Estándar** | $92 | $190 | **≈ $282 USD** |

---

## 4. Incluido en la garantía — SIN COSTO

Los siguientes servicios se brindan **sin costo alguno** para el cliente:

- ✅ **Corrección de cualquier error (bug)** que surja — de forma indefinida.
- ✅ **Mejoras al motor del bot** — para llevarlo al nivel óptimo de desempeño.
- ✅ **Revisión de datos con enfoque de Big Data** — una vez que la información alcance un año de antigüedad.

---

*Los costos de operación reflejan el uso actual del sistema y pueden variar ligeramente según el volumen de tráfico (campañas publicitarias, temporada). El costo de OpenAI se ajusta al consumo real.*
