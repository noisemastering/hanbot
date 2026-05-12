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
    title: 'Simulador "¿Qué pasaría si...?"',
    icon: '🎛️',
    content: [
      { q: '¿Qué es el simulador?', a: 'Es una herramienta dentro del pronóstico que permite simular escenarios. Ajustas parámetros como inversión en publicidad, número de anuncios, tasa de conversión y promociones, y el sistema proyecta cómo cambiarían tus ingresos. Aparece una línea dorada en la gráfica con la proyección simulada junto a la proyección base (morada).' },
      { q: '¿Qué modelo matemático usa?', a: 'Usa un modelo logístico (curva S o curva sigmoide), el mismo que se usa en economía y marketing para modelar adopción de productos y rendimiento publicitario. La idea clave: duplicar tu inversión NO duplica tus ventas. Al inicio cada peso invertido rinde mucho, pero conforme inviertes más, el retorno disminuye hasta llegar a un techo (saturación de mercado).' },
      { q: '¿Cómo se calibra la curva S?', a: 'Se calibra automáticamente con tus datos reales. El sistema toma tres puntos: 1) Tu ingreso orgánico (lo que vendes sin publicidad — la base), 2) Tu punto actual (cuánto inviertes y cuánto generas hoy), 3) El techo estimado de mercado (calculado según tu nivel de penetración actual). Con estos tres puntos resuelve la ecuación logística.' },
      { q: '¿Qué es el techo de mercado?', a: 'Es el ingreso máximo que podrías alcanzar por más que inviertas en publicidad. Se estima en función de qué tan penetrado está tu mercado: si tus ads generan menos del 10% de tus ventas, hay mucho espacio para crecer (techo alto). Si ya generan más del 35%, estás cerca de la saturación (techo bajo). No importa cuánto gastes, no puedes superar este techo solo con publicidad.' },
      { q: '¿Qué es el retorno marginal?', a: 'Indica cuánto ingreso adicional generaría cada $1,000 extra invertidos EN TU NIVEL ACTUAL de gasto. Si dice "$2,500 por cada $1,000 adicionales" significa que todavía hay buen retorno. Si dice "$200 por cada $1,000" estás cerca de la saturación y tu dinero rinde poco. Esto te ayuda a decidir si vale la pena escalar o si es mejor invertir en otro producto/canal.' },
      { q: '¿Qué hacen los controles?', a: 'Inversión en Ads: mueve tu posición en la curva S (de 0x a 3x tu inversión actual). Anuncios nuevos: expande el techo de mercado (más anuncios = más alcance = más potencial). Mejor conversión: hace que la curva suba más rápido (conviertes más visitas en ventas). Boost de promo: multiplicador temporal por una promoción activa.' },
      { q: '¿Qué muestra la gráfica de la curva?', a: 'La línea morada es la curva S de rendimiento. El punto morado es donde estás hoy. El punto dorado es donde estarías con los cambios simulados. La línea verde horizontal es tu ingreso orgánico (sin ads). La línea roja es el techo de mercado. Puedes ver visualmente si estás en la zona de crecimiento o en la zona de saturación.' },
      { q: '¿Qué es la barra de "Posición en el mercado"?', a: 'Es un indicador visual de dónde estás en la curva S. Verde = inicio (mucho potencial de crecimiento), amarillo = punto óptimo (mejor relación inversión/retorno), rojo = saturación (invertir más no ayuda). Lo ideal es estar en la zona amarilla-verde.' },
      { q: '¿Qué tan preciso es?', a: 'El modelo es una aproximación calibrada con datos reales, no una predicción exacta. Es más preciso para responder "¿tiene sentido invertir más?" que para predecir cifras exactas. Factores como competencia, temporada, calidad del creative y cambios en el algoritmo de Facebook afectan los resultados reales. Úsalo como guía directiva, no como promesa de resultados.' }
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
