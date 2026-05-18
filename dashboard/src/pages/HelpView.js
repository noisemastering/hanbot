import React, { useState } from 'react';

const sections = [
  {
    id: 'overview',
    title: 'Panel General',
    icon: '🏠',
    content: [
      { q: '¿Qué muestra el Panel General?', a: 'Es tu vista principal. Muestra los indicadores clave del día: conversaciones activas, clics generados, conversiones, ingresos y gasto en publicidad. También incluye gráficas diarias y los 4 donuts de distribución (geografía, género, canal y productos).' },
      { q: '¿Qué es la "Última correlación"?', a: 'Indica cuándo fue la última vez que el sistema cruzó los clics de tus links con las órdenes de Mercado Libre para determinar qué ventas vinieron de qué anuncios. Esto corre automáticamente.' },
      { q: '¿Por qué mis cifras de ventas no aparecen?', a: 'Si tu perfil es Administrador de Campaña, las cifras de ventas se ocultan por diseño. Solo los roles con acceso a datos financieros pueden verlas.' }
    ]
  },
  {
    id: 'conversations',
    title: 'Conversaciones',
    icon: '💬',
    content: [
      { q: '¿Qué son las conversaciones?', a: 'Cada vez que un cliente contacta al bot por Facebook Messenger o WhatsApp, se crea una conversación. Aquí puedes ver el historial completo de mensajes, el estado del flujo, y los datos del cliente.' },
      { q: '¿Puedo responder desde aquí?', a: 'No. Las conversaciones son de solo lectura. El bot responde automáticamente según el flujo asignado. Si necesitas intervenir, asigna la conversación a un asesor humano.' },
      { q: '¿Qué significa "Handoff"?', a: 'Es cuando el bot transfiere la conversación a un vendedor humano, ya sea porque el cliente lo solicitó, la medida es especial, o el flujo así lo requiere.' }
    ]
  },
  {
    id: 'campaigns',
    title: 'Campañas',
    icon: '📣',
    content: [
      { q: '¿Cómo se organizan las campañas?', a: 'Siguen la estructura de Facebook Ads: Campaña → Conjunto de Anuncios (Ad Set) → Anuncios (Ads). Cada nivel tiene su propia vista con métricas.' },
      { q: '¿Qué es el botón "Sync Facebook"?', a: 'Sincroniza la estructura de campañas desde Facebook Ads Manager. Trae campañas, conjuntos y anuncios nuevos o actualizados.' },
      { q: '¿Qué es el Flujo en un anuncio?', a: 'El flujo de conversación determina cómo el bot atiende a quien entra por ese anuncio. Si dice "⚠️ Genérico", el bot no sabe qué producto ofrecer — asigna un flujo para mejorar la conversión.' },
      { q: '¿Qué es una Promo en un anuncio?', a: 'Es un plugin de promoción opcional. Cuando un cliente entra por un anuncio con promo, el bot le presenta la oferta especial (precio promocional, condiciones, vigencia) antes del flujo normal.' },
      { q: '¿Qué es el Link Directo?', a: 'Un link tracked que puedes copiar y usar fuera de Facebook (ej: WhatsApp, email). Registra clics y conversiones igual que los links del bot.' }
    ]
  },
  {
    id: 'adperformance',
    title: 'Desempeño de Anuncios',
    icon: '📊',
    content: [
      { q: '¿Qué muestra esta vista?', a: 'Métricas detalladas por anuncio: links generados, clics, conversiones, tasa de conversión, ingresos y gasto. Cada fila tiene un botón "Detalle" que despliega gráficas diarias, desglose geográfico, por género y por dispositivo.' },
      { q: '¿De dónde viene el dato de inversión?', a: 'Directamente de la API de Facebook Ads (Insights). Se actualiza al sincronizar.' },
      { q: '¿Qué es el ROI?', a: 'Retorno sobre inversión = Ingresos ÷ Inversión. Un ROI de 5x significa que por cada peso invertido, se generaron $5 en ventas.' }
    ]
  },
  {
    id: 'segmentation',
    title: 'Segmentación',
    icon: '👥',
    content: [
      { q: '¿Qué muestra la segmentación?', a: 'Cruza datos de estado (geografía) con género para identificar dónde y a quién vendes más. Incluye gráficas apiladas por estado y por tamaño de producto.' },
      { q: '¿Cómo detectan el género?', a: 'A partir del nombre del comprador usando un diccionario de ~700 nombres mexicanos. Los nombres ambiguos (como Guadalupe) se marcan como "desconocido".' },
      { q: '¿Puedo filtrar por periodo?', a: 'Sí. Usa el selector de rango de fechas en la parte superior (7d, 30d, 90d).' }
    ]
  },
  {
    id: 'optimization',
    title: 'Optimización de Gasto',
    icon: '💰',
    content: [
      { q: '¿Qué muestra esta vista?', a: 'Compara la inversión en cada anuncio contra los ingresos que generó. Clasifica cada anuncio como Óptimo, Bueno, Moderado o Decreciente según su eficiencia.' },
      { q: '¿Qué es el CPA?', a: 'Costo Por Adquisición = Inversión ÷ Conversiones. Cuánto te cuesta cada venta.' },
      { q: '¿Qué significa "On-target" vs "Cross-sell"?', a: 'On-target = ventas del producto que el anuncio promociona. Cross-sell = ventas de otros productos. Si tu anuncio de 6x4 vende más 3x4, hay un desalineamiento.' }
    ]
  },
  {
    id: 'flujos',
    title: 'Flujos',
    icon: '🔀',
    content: [
      { q: '¿Qué es un flujo?', a: 'Un flujo de conversación define cómo el bot atiende a un cliente: qué producto ofrece, si es menudeo o mayoreo, el tono de voz, y si cierra la venta por ML o con un asesor humano.' },
      { q: '¿Cómo creo un flujo?', a: 'Usa el botón "Nuevo Flujo". El wizard te guía paso a paso: 1) Selecciona la familia de producto, 2) Define el canal de venta y perfil del cliente, 3) Configura la personalidad del bot.' },
      { q: '¿Qué flujos se incluyen automáticamente?', a: 'Cada flujo incluye: el flujo maestro (preguntas generales, ubicación, horarios), flujo de producto (precios, medidas), flujo de venta (menudeo o mayoreo), y flujo de persona (comprador o revendedor).' },
      { q: '¿Cómo asigno un flujo a un anuncio?', a: 'En la vista de Anuncios, cada fila tiene una columna "Flujo". Edita el anuncio y selecciona el flujo deseado.' }
    ]
  },
  {
    id: 'tracked-links',
    title: 'Links de Seguimiento',
    icon: '🔗',
    content: [
      { q: '¿Qué son los links tracked?', a: 'Cada vez que el bot comparte un link de Mercado Libre, lo envuelve en un link de seguimiento (agente.hanlob.com.mx/r/...). Esto permite rastrear quién hizo clic y si compró.' },
      { q: '¿Puedo crear links manuales?', a: 'Sí. Desde esta vista puedes generar links tracked para cualquier URL. Útil para compartir por WhatsApp o email fuera del bot.' }
    ]
  },
  {
    id: 'crm',
    title: 'CRM',
    icon: '📋',
    content: [
      { q: '¿Qué contiene el CRM?', a: 'Dos secciones: Clientes (datos de contacto, historial de compras, origen) y Ventas (registro de todas las ventas, tanto de ML como manuales).' },
      { q: '¿Cómo registro una venta manual?', a: 'En la vista de Ventas, usa el botón "Nueva venta". Selecciona el producto del catálogo (con autocompletado), ingresa monto, cliente y fecha. Las ventas manuales se integran a las proyecciones.' },
      { q: '¿Puedo editar datos de un cliente?', a: 'Sí. Haz clic en un cliente para ver su detalle. Puedes editar nombre, teléfono, email y código postal.' }
    ]
  },
  {
    id: 'catalog',
    title: 'Catálogo de Productos',
    icon: '📦',
    content: [
      { q: '¿Cómo se organizan los productos?', a: 'En un árbol jerárquico: Familia → Subfamilia → Producto vendible. Por ejemplo: Malla Sombra Raschel → 90% → Confeccionada con Refuerzo → Rectangular → 6x4m.' },
      { q: '¿Qué es un producto "vendible"?', a: 'Es el nivel más bajo del árbol — el producto que se puede comprar en ML. Tiene precio, link de tienda, tamaño, y color.' },
      { q: '¿Para qué sirve el Inventario?', a: 'Registra las existencias por producto y punto de venta. Permite controlar el stock disponible.' },
      { q: '¿Qué son los Puntos de Venta?', a: 'Ubicaciones físicas o virtuales donde vendes. Cada punto de venta puede tener su propio inventario.' }
    ]
  },
  {
    id: 'ml-orders',
    title: 'Órdenes de Mercado Libre',
    icon: '🛒',
    content: [
      { q: '¿Qué muestra esta vista?', a: 'Las órdenes de tu cuenta de Mercado Libre en tiempo real. Puedes filtrar por fecha, ver detalles de cada orden (producto, comprador, monto, envío).' },
      { q: '¿Hasta cuándo puedo ver órdenes?', a: 'La API de ML muestra ~90 días de órdenes recientes. Para datos más antiguos, usa la importación histórica.' }
    ]
  },
  {
    id: 'forecast',
    title: 'Pronóstico de Ventas',
    icon: '📈',
    content: [
      { q: '¿Cómo funciona el pronóstico?', a: 'Selecciona un producto (o Global para todo) y un canal de venta. El sistema analiza tu historial de ventas de Mercado Libre (importado) y genera una proyección a 14 días usando regresión lineal ajustada por día de la semana y estacionalidad mensual.' },
      { q: '¿De dónde vienen los datos?', a: 'De tres fuentes: 1) Órdenes de Mercado Libre (historial importado, base principal), 2) Ventas manuales registradas en el CRM, 3) Datos de campañas de Meta/Facebook (como modificador de atribución, no como fuente de ingresos adicional). ML es la fuente de verdad — las campañas solo explican qué porcentaje de esas ventas fue impulsado por publicidad.' },
      { q: '¿Qué son las barras verdes y azules en la gráfica?', a: 'Verde = ingresos sin atribución directa a un anuncio (el cliente no usó un link de seguimiento). Azul = ingresos atribuidos a un anuncio específico (el cliente llegó por un link tracked del bot). Juntas suman el ingreso total. El "boost de Ads" muestra el impacto visible de tus campañas.' },
      { q: '¿Qué es la Predictibilidad?', a: 'Indica qué tan estable es el patrón de ventas. "Variable" significa que las ventas diarias fluctúan mucho (normal en retail). "Moderada" indica cierta consistencia. "Alta" significa un patrón muy predecible. No es una calificación — solo describe la naturaleza de tus datos.' },
      { q: '¿Qué es la estacionalidad?', a: 'Un multiplicador por mes del año calculado a partir de tu historial. Cada barra representa qué tan fuerte o débil es ese mes comparado con el promedio. Coloreado por temporada: azul (Invierno), verde (Primavera), amarillo (Verano), naranja (Otoño). Meses cálidos suelen ser más fuertes para malla sombra.' },
      { q: '¿Puedo ajustar el periodo de análisis?', a: 'Sí. Desde 30 días hasta 2 años. Más historia da mejor estacionalidad pero puede incluir patrones obsoletos. La gráfica se adapta automáticamente: periodo largo muestra barras mensuales, medio muestra semanales, corto muestra diarias. Puedes cambiar la vista manualmente con los botones Mes/Sem/Día.' },
      { q: '¿Puedo ver el pronóstico por producto específico?', a: 'Sí. Al iniciar, puedes navegar el árbol de productos: desde familias generales (Malla Sombra Raschel) hasta subfamilias específicas (90% → Confeccionada con Refuerzo → Rectangular). También puedes elegir "Global" para ver todos los productos combinados.' }
    ]
  },
  {
    id: 'simulator',
    title: 'Simulador de Campaña',
    icon: '🎛️',
    content: [
      { q: '¿Qué es el simulador?', a: 'Es una herramienta dentro del pronóstico que permite simular el resultado de una campaña publicitaria. Defines la duración, ajustas presupuesto, número de anuncios, audiencia y tipo de anuncio, y el sistema proyecta semana a semana cuánto generarías. La proyección aparece como barras apiladas (orgánico + ads) junto a una línea base (sin cambios).' },
      { q: '¿Cómo funciona paso a paso?', a: '1) Elige la duración de la campaña (1 semana a 6 meses). 2) Ajusta los controles: presupuesto, anuncios, target, tipo. 3) El sistema genera una proyección semana a semana considerando fatiga de audiencia, estacionalidad y techo de mercado. 4) La curva teórica en la esquina muestra el comportamiento general.' },
      { q: '¿De dónde salen los datos iniciales?', a: 'Del Facebook Marketing API. El sistema importa tu presupuesto diario actual, número de anuncios activos, tipo de campaña dominante (clics o presencia) y ubicaciones de targeting. Estos valores aparecen como referencia arriba de los controles.' },
      { q: '¿Qué significan los controles?', a: 'Presupuesto: multiplicador sobre tu inversión actual (0 = sin ads, 1x = actual, 3x = triple). Anuncios: cuántos anuncios adicionales lanzar. Ampliar target: expandir tu audiencia objetivo. Tipo de anuncio: Clics (conversión directa, fatiga más rápido) o Presencia (reconocimiento, fatiga más lento).' },
      { q: '¿Qué es el punto óptimo en cada slider?', a: 'El punto ámbar indica el valor recomendado para la duración seleccionada. Campañas cortas pueden empujar presupuesto más alto porque no hay tiempo para saturar. Campañas largas necesitan más anuncios y audiencia ampliada para combatir la fatiga. El punto se mueve al cambiar la duración.' },
      { q: '¿Qué es la fatiga de audiencia?', a: 'Cuando un anuncio se muestra repetidamente, su efectividad baja. Semanas 1-2: 100%. Semanas 3-4: ~92%. Semanas 5-8: ~78%. Semana 9+: sigue bajando. Los anuncios de clics se fatigan 30% más rápido que los de presencia.' },
      { q: '¿Qué muestra la gráfica de barras?', a: 'Barras apiladas semana a semana: verde = ingresos orgánicos, azul = contribución de ads. La línea morada punteada es lo que pasaría sin cambios. Si las barras azules se achican, es la fatiga actuando.' },
      { q: '¿Qué es la curva teórica?', a: 'La mini curva en la esquina muestra el comportamiento matemático abstracto. Verde "Lineal": cada peso extra rinde igual. Ámbar "Rendimiento decreciente": cada peso rinde menos. Naranja "Fatiga": sube y luego baja. Rojo "Saturado": invertir más no genera más. Cambia en tiempo real al mover los controles.' },
      { q: '¿Qué es el techo de mercado?', a: 'El ingreso máximo alcanzable sin importar cuánto inviertas. Si los ads generan menos del 10% de tus ventas, hay mucho espacio. Si ya generan más del 35%, estás cerca del límite. Agregar anuncios o ampliar target sube el techo; solo aumentar presupuesto no.' },
      { q: '¿Qué tan preciso es?', a: 'Es una guía para tomar decisiones, no una predicción exacta. Responde "¿me conviene invertir más?" mejor que "¿cuánto exactamente ganaré?". Úsalo para comparar escenarios y decidir la mejor estrategia.' }
    ]
  },
  {
    id: 'tickets',
    title: 'Tickets',
    icon: '🎫',
    content: [
      { q: '¿Qué son los tickets?', a: 'Un sistema para reportar errores, solicitar mejoras o comunicar cualquier problema con la plataforma. Cualquier usuario puede crear un ticket y agregar comentarios.' },
      { q: '¿Cómo creo un ticket?', a: 'En la sección Tickets, haz clic en "Nuevo ticket". Escribe un título descriptivo, una descripción detallada del problema y selecciona la prioridad (baja, media o alta). El ticket se crea con estado "Abierto".' },
      { q: '¿Cuáles son los estados de un ticket?', a: 'Abierto: recién creado. En revisión: un administrador lo está evaluando. Trabajando: se está solucionando activamente. Resuelto: el problema fue solucionado. Descartado: se determinó que no procede. Solo administradores pueden cambiar el estado.' },
      { q: '¿Puedo agregar comentarios?', a: 'Sí. Cualquier usuario puede agregar comentarios a cualquier ticket. Usa los comentarios para dar seguimiento, agregar información adicional o hacer preguntas.' },
      { q: '¿Puedo eliminar un ticket?', a: 'Solo los administradores pueden eliminar tickets. Si creaste un ticket por error, puedes agregar un comentario pidiendo que se descarte.' }
    ]
  },
  {
    id: 'notifications',
    title: 'Notificaciones',
    icon: '🔔',
    content: [
      { q: '¿Qué son las notificaciones?', a: 'Anuncios enviados por los administradores. Pueden ser globales (para todos los usuarios) o individuales (dirigidos a un usuario específico). No se pueden responder — son comunicados de una vía.' },
      { q: '¿Cómo sé si tengo notificaciones nuevas?', a: 'Un badge rojo con el número de notificaciones no leídas aparece en el menú lateral junto a "Notificaciones". El conteo se actualiza automáticamente cada minuto.' },
      { q: '¿Cómo marco una notificación como leída?', a: 'Se marca automáticamente al expandir la notificación. También puedes usar "Marcar todas como leídas" para limpiar el conteo de una vez.' },
      { q: '¿Puedo enviar notificaciones?', a: 'Solo administradores y super administradores pueden enviar notificaciones. Si necesitas comunicar algo al equipo, crea un ticket o habla con tu administrador.' }
    ]
  },
  {
    id: 'crosssell',
    title: 'Cross-Selling',
    icon: '🔄',
    content: [
      { q: '¿Qué es el cross-selling?', a: 'Es una funcionalidad en desarrollo que permitirá configurar reglas de venta cruzada. Por ejemplo: cuando un cliente compra malla confeccionada, sugerirle automáticamente la cuerda para instalarla. Próximamente disponible.' }
    ]
  }
];

export default function HelpView() {
  const [openSection, setOpenSection] = useState(null);
  const [openQuestion, setOpenQuestion] = useState(null);
  const [search, setSearch] = useState('');

  const filteredSections = search.trim()
    ? sections.map(s => ({
        ...s,
        content: s.content.filter(c =>
          c.q.toLowerCase().includes(search.toLowerCase()) ||
          c.a.toLowerCase().includes(search.toLowerCase())
        )
      })).filter(s => s.content.length > 0)
    : sections;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Ayuda</h1>
        <p className="text-gray-400 mt-2">Guía de uso del dashboard de Hanlob</p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOpenSection(null); setOpenQuestion(null); }}
          placeholder="Buscar en la ayuda..."
          className="w-full pl-10 pr-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
        />
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {filteredSections.map(section => {
          const isOpen = openSection === section.id || search.trim();
          return (
            <div key={section.id} className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
              {/* Section header */}
              <button
                onClick={() => { setOpenSection(isOpen && !search ? null : section.id); setOpenQuestion(null); }}
                className="w-full px-5 py-4 flex items-center gap-3 hover:bg-gray-700/20 transition-colors"
              >
                <span className="text-xl">{section.icon}</span>
                <span className="text-sm font-semibold text-white flex-1 text-left">{section.title}</span>
                <span className="text-xs text-gray-500">{section.content.length} preguntas</span>
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Questions */}
              {isOpen && (
                <div className="border-t border-gray-700/50">
                  {section.content.map((item, i) => {
                    const qKey = `${section.id}-${i}`;
                    const qOpen = openQuestion === qKey || search.trim();
                    return (
                      <div key={i} className="border-b border-gray-700/30 last:border-b-0">
                        <button
                          onClick={() => setOpenQuestion(qOpen && !search ? null : qKey)}
                          className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-700/10 transition-colors text-left"
                        >
                          <span className="text-primary-400 text-sm">?</span>
                          <span className="text-sm text-gray-300 flex-1">{item.q}</span>
                          <svg className={`w-3.5 h-3.5 text-gray-600 transition-transform flex-shrink-0 ${qOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {qOpen && (
                          <div className="px-5 pb-4 pl-12">
                            <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredSections.length === 0 && (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-gray-400">No se encontraron resultados para "{search}"</p>
        </div>
      )}
    </div>
  );
}
