# Hanlob Bot — Feature Overview for Keynote Presentation

## 1. Chatbot Conversacional Inteligente

### Arquitectura de flujos
- Sistema de flujos modulares: cada producto tiene su propio flujo de conversación (convo_flow) que define cómo el bot atiende al cliente
- Flujos compuestos de capas: flujo maestro (preguntas generales) + flujo de producto (precios, medidas) + flujo de venta (menudeo/mayoreo) + flujo de persona (comprador/revendedor)
- Todos los flujos son DB-driven: se crean, editan y asignan desde el dashboard sin tocar código

### Capacidades del bot
- Entiende lenguaje natural en español mexicano — no obliga al usuario a responder con números o formatos específicos
- Parseo de dimensiones con IA: "3.60 x 2.50 mts" → redondea a 4x3m, ofrece la medida estándar más cercana y pregunta si le funciona
- Conversión de pies a metros automática
- Manejo de medidas especiales: si ambos lados > 8m, transfiere a un especialista para cotización personalizada
- Detección de intenciones con IA cuando el regex no puede parsear el mensaje del cliente
- Funcionamiento dual: Facebook Messenger y WhatsApp

### Promos como plugin
- Las promociones son plugins que se adjuntan a nivel de anuncio, no al flujo
- Un mismo flujo puede correr con o sin promo dependiendo del anuncio por el que entró el cliente
- El bot presenta automáticamente precio promocional, condiciones y vigencia

### Transferencia inteligente
- Handoff a vendedor humano cuando el caso lo requiere (medidas especiales, insistencia en medida exacta, volumen)
- El bot recopila datos (medidas, código postal, nombre) antes de transferir para que el vendedor tenga contexto completo

---

## 2. Dashboard de Administración

### Panel General
- KPIs en tiempo real: conversaciones, clics, conversiones, ingresos, gasto publicitario
- Gráficas diarias con tooltip detallado
- 4 donuts de distribución: geografía, género, canal, productos
- Indicador de última correlación ML↔ClickLog

### Gestión de Campañas
- Estructura completa sincronizada con Facebook: Campañas → Conjuntos → Anuncios
- Botón "Sync Facebook" para importar/actualizar estructura desde FB Ads Manager
- Cada anuncio tiene: flujo asignado, promo opcional, link directo tracked, estado
- Métricas por nivel: impresiones, clics, gasto, alcance, CTR, CPC, CPM, conversiones

### Desempeño de Anuncios
- Vista detallada por anuncio con gráficas diarias
- Desglose geográfico (por estado), por género (detección automática de ~700 nombres mexicanos), por dispositivo
- Inversión vs ingresos por anuncio
- ROI calculado: ingresos ÷ inversión

### Segmentación
- Cruce de variables: Estado × Género con gráficas apiladas
- Tamaño de producto × Género
- Selector de periodo (7d, 30d, 90d)
- Tabla detallada con conteos, porcentajes, ticket promedio, ingresos

### Optimización de Gasto
- Clasificación de eficiencia por anuncio: Óptimo / Bueno / Moderado / Decreciente
- CPA (Costo por Adquisición)
- Detección de cross-sell: cuando un anuncio vende productos diferentes al anunciado
- On-target vs cross-sell por anuncio
- Recomendaciones de reasignación de presupuesto

---

## 3. Inteligencia de Campaña

### Recomendaciones automáticas basadas en datos
- **Desalineación de producto**: detecta cuando un anuncio vende más un producto diferente al que anuncia — sugiere crear anuncio dedicado
- **Fatiga de anuncio**: compara primera mitad vs segunda mitad del periodo, detecta declive > 30% en ingresos o clics
- **Detección de ciclos**: identifica patrones cíclicos (picos y valles cada N días) y determina en qué fase estás
- **Reasignación de presupuesto**: señala los anuncios de menor ROI y sugiere mover inversión a los de mayor ROI
- **Oportunidades sin explotar**: productos que venden orgánicamente sin inversión en ads
- **Runner-ups**: productos que son #2-5 en ventas sin anuncio dedicado
- **Alertas de cero conversión**: anuncios gastando sin generar ventas
- **Contexto de estado**: distingue entre "ventas cayendo con ads activos" (problema real) vs "ventas cayendo con ads pausados" (esperado)

### Priorización
- Cada recomendación tiene prioridad (Alta / Media / Baja / Info)
- Filtrable por categoría
- Expandible con gráfica de tendencia y tabla de anuncios afectados por producto

---

## 4. Pronóstico de Ventas

### Datos
- Basado en órdenes históricas importadas de Mercado Libre (~100,000+ órdenes, hasta 5 años de historia)
- Normalización de productos con IA: títulos de ML mapeados al catálogo actual (83%+ cobertura)
- Integración de ventas manuales del CRM
- Atribución de Meta como modificador: muestra qué porcentaje de ventas fue impulsado por ads

### Configuración interactiva
- Selección de producto: navegación recursiva del árbol de productos (Global → familia → subfamilia)
- Canal de venta: Todos / Tiendas en línea / Mercado Libre / Ventas manuales
- Periodo ajustable: 30 días a 2 años
- Zoom de gráfica: Mes / Semana / Día (auto-selección inteligente + override manual)

### Visualizaciones
- Gráfica principal con barras apiladas (orgánico + boost de ads) + línea de proyección + banda de confianza
- Toggle para mostrar/ocultar el impacto de campañas en las barras
- Estacionalidad por temporada: Invierno (azul), Primavera (verde), Verano (amarillo), Otoño (naranja) — con mejor temporada destacada
- Patrón semanal: mejor día (verde) y peor día (rojo) destacados
- Desglose mensual con proyección para mes parcial
- Indicador de predictibilidad (Variable / Moderada / Alta) en lugar de R² crudo

### Presentación teatral
- Secuencia de carga con 6 etapas animadas (spinner cerebro, barra de progreso, checklist progresivo)
- Reveal con fade-in al completar
- ~14 segundos de "análisis" que corre en paralelo con el API call real

---

## 5. Simulador de Campaña ("¿Qué pasaría si...?")

### Concepto
- Permite al administrador de campaña simular el resultado de una campaña antes de lanzarla
- Responde la pregunta clave: "Si invierto $X durante N semanas, ¿cuánto más voy a vender?"
- Modelo NO lineal: duplicar inversión ≠ duplicar ventas

### Controles basados en decisiones reales
- **Duración**: 1 semana a 6 meses
- **Presupuesto**: 0 a 3x la inversión actual (importada de Facebook)
- **Anuncios**: agregar ads sobre el conteo actual (importado de Facebook)
- **Ampliar target**: expandir audiencia 0-100%
- **Tipo de anuncio**: Clics (conversión directa) vs Presencia (reconocimiento de marca)
- Punto óptimo (ámbar) en cada slider que se ajusta según la duración

### Modelo matemático
- Logístico con fatiga de audiencia
- Fatiga: rendimiento baja semana a semana (100% → 92% → 78% → 65%...)
- Anuncios de clics se fatigan 30% más rápido, presencia 30% más lento
- Techo de mercado: ingreso máximo independiente de cuánto inviertas
- Estacionalidad aplicada por mes del año
- Rendimientos decrecientes en presupuesto (exponente 0.7)
- Más anuncios expanden el techo (reach), no lo empujan linealmente
- Ampliar target se traduce a 60% de incremento real en alcance

### Visualización
- Curva teórica en tiempo real (SVG): muestra la forma matemática que emerge de los parámetros
  - Verde "Lineal" (campañas cortas)
  - Ámbar "Rendimiento decreciente" (clásico)
  - Naranja "Fatiga" (campañas largas)
  - Rojo "Saturado" (mercado agotado)
- Gráfica de barras semana a semana: orgánico (verde) + ads (azul) + baseline punteada (morada)
- Tooltip por semana: desglose orgánico, ads, fatiga %, estacionalidad
- Resumen: Sin cambios vs Con simulación vs Diferencia + Ventas proyectadas por semana
- Posición en el mercado: barra gradiente (verde → ámbar → rojo)

---

## 6. CRM

### Clientes
- Datos de contacto, historial de compras, origen (ad, orgánico, manual)
- Detección de género automática desde nombre (~700 nombres mexicanos)
- Búsqueda y edición

### Ventas
- Registro de ventas manuales con autocompletado de producto
- Integración con el pronóstico (ventas manuales se suman al global)
- Validación de fecha (máximo 30 días atrás)

---

## 7. Catálogo de Productos

### Árbol jerárquico
- Familia → Subfamilia → Producto vendible
- Ejemplo: Malla Sombra Raschel → 90% → Confeccionada con Refuerzo → Rectangular → 6x4m
- Cada nivel puede tener: precio, link de ML, tamaño, colores, atributos, imagen

### Wizard de creación de flujos
- 4 pasos: Producto (navegación recursiva) → Canal (menudeo/mayoreo) → Personalidad (voz, notas) → Confirmación
- Genera automáticamente el nombre del flujo
- Registra el flujo en la DB y lo activa en el runtime del bot

---

## 8. Importación de Órdenes de Mercado Libre

### Importación histórica
- Trae todas las órdenes de ML (recientes + archivadas, hasta 5 años)
- Paginación por ventanas mensuales con rate limiting
- Deduplicación automática — re-importar no duplica datos
- Re-importaciones inteligentes: empieza desde la última orden importada

### Normalización de productos
- Bootstrap automático desde links de ML existentes en el catálogo
- IA (GPT-4o-mini) mapea títulos de ML al catálogo actual
- Interfaz de revisión manual para mapeos de baja confianza
- 83%+ de cobertura después de primera pasada

---

## 9. Monitoreo y Salud

### OpenAI Budget
- Tracking de uso diario y mensual de la API de OpenAI
- Alertas antes de agotar créditos (umbrales configurables)
- Por modelo: costo, llamadas, tokens, errores
- Solo visible para admin y super admin

### Tooltips de onboarding
- Sistema FeatureTip para usuarios nuevos
- 35+ tips contextuales en todas las rutas
- Persistencia en localStorage
- Posición configurable (top, bottom, left, right)

---

## 10. Sistema de Roles y Perfiles

### Roles
- super_admin: acceso total
- admin: gestión de usuarios
- user: acceso basado en perfil

### Perfiles
- Administrador de Campaña: campañas, ads, desempeño, segmentación, optimización, flujos, pronóstico
- Contabilidad: conversaciones, campañas, CRM, analytics
- Ventas: conversaciones, CRM, clientes
- Administrador de Producto: inventario, productos, familias

### Simulación de rol
- Los admins pueden "ver como" otro perfil para verificar permisos
- Oculta datos sensibles (ventas) según el perfil simulado

---

## 11. Infraestructura

### Canales
- Facebook Messenger + WhatsApp (dual channel)
- Cada feature se wirea en ambos paths de entrada

### Deployment
- Dashboard: Vercel (auto-deploy desde git push)
- Bot Server: Railway
- Base de datos: MongoDB Atlas
- IA: OpenAI GPT-4o-mini (con monkey-patching para tracking de uso)

### Integraciones
- Facebook Marketing API (campañas, métricas, spend, targeting)
- Mercado Libre API (órdenes, OAuth, archivadas)
- Arquitectura preparada para Amazon, Walmart y otros marketplaces

---

## 12. Sistema de Tickets

### Reporte de errores y solicitudes
- Cualquier usuario puede crear un ticket con título, descripción y prioridad (baja, media, alta)
- Sistema de comentarios: cualquier usuario puede agregar seguimiento a cualquier ticket
- Solo administradores pueden cambiar estado y asignar responsable

### Estados del ciclo de vida
- **Abierto**: recién creado, pendiente de revisión
- **En revisión**: un administrador lo está evaluando
- **Trabajando**: se está solucionando activamente
- **Resuelto**: problema solucionado
- **Descartado**: se determinó que no procede

### Interfaz
- Vista de lista con badges de estado coloreados y prioridad
- Filtros por pestaña: Todos, Abiertos, En revisión, Trabajando, Resueltos, Descartados
- Detalle expandible con hilo de comentarios
- Administradores ven controles de estado y asignación

---

## 13. Centro de Notificaciones

### Comunicación interna
- Administradores pueden enviar anuncios globales (a todos) o individuales (a un usuario específico)
- Las notificaciones son de una vía — no permiten respuesta
- Ideal para comunicar cambios, actualizaciones, alertas del sistema

### Experiencia de usuario
- Badge rojo con conteo de no leídas en el menú lateral
- Polling automático cada 60 segundos para detectar nuevas notificaciones
- Auto-marca como leída al expandir la notificación
- Opción "Marcar todas como leídas"
- Notificaciones no leídas resaltadas visualmente

---

## 14. Cross-Selling Inteligente

### Descubrimiento automático de patrones
- Motor de minería analiza +100,000 órdenes históricas de Mercado Libre
- Dos métodos de detección:
  - **Within-order**: productos comprados juntos en la misma orden (señal fuerte — el cliente literalmente compró ambos)
  - **Cross-order**: productos comprados por el mismo cliente en diferentes órdenes dentro de 90 días (patrón "regresó por el accesorio")
- Métricas de asociación: soporte (frecuencia), confianza (P(B|A)), lift (cuánto más probable que al azar)
- Score combinado con bonus para co-compras en misma orden
- Genera automáticamente las top 50 sugerencias como reglas inactivas para revisión del admin

### Reglas de venta cruzada
- Cada regla conecta un producto origen → producto destino
- 3 tipos de disparador: durante la conversación, antes de cerrar la venta, post-compra
- Mensaje personalizable por regla
- Prioridad configurable (las reglas de mayor puntaje se ofrecen primero)
- Distinción visual: 🧠 Descubierta (auto-generada) vs ✏️ Manual (creada por admin)

### Integración con el bot
- **Momento de activación**: después de compartir el link de compra, cuando el cliente responde positivamente ("sí", "gracias", código postal)
- El bot busca reglas activas que coincidan con el producto cotizado (busca en todo el árbol de familias)
- Genera un link tracked para el producto sugerido
- Solo ofrece una vez por producto por conversación (no repite)
- Ejemplo: _"Los clientes que compran malla de 6x4 también suelen llevar cuerda para instalarla. 🛒 Cuerda: [link]"_

### Pipeline de tracking completo
- **Ofrecida**: se incrementa cuando el bot muestra la sugerencia
- **Clic**: se incrementa cuando el cliente hace clic en el link de cross-sell
- **Conversión**: se incrementa cuando ese clic se correlaciona con una venta en ML
- **Ingresos**: revenue atribuido a cross-selling calculado desde las conversiones

### Dashboard de rendimiento
- 5 KPIs: ofertas realizadas, clics (con tasa), conversiones (con tasa), ingresos por cross-sell, reglas activas
- Por regla: nombre, origen → destino, ofrecidas, clics, conversiones, tasas
- Botón "🧠 Descubrir patrones" ejecuta el motor de minería con progreso en tiempo real
