# Costos de OpenAI — Bot Hanlob

**Fecha del análisis:** 13 de junio de 2026
**Datos base:** uso real del 14 de mayo al 13 de junio de 2026 (OpenAI Usage + Cost) + volumen de conversaciones de MongoDB.

> **Nota sobre "medido" vs "estimado":**
> - **Medido** = sale directo del uso histórico de OpenAI (sólido).
> - **Estimado** = el verificador de respuestas (grounding check) se activó el sábado 13 de junio, así que su costo aún se proyecta. Se confirma con datos reales el lunes 15 de junio.

---

## 1. Costo mensual total (al volumen actual)

| Escenario | Costo mensual |
|---|---|
| **Run-rate medido** (últimos 7 días, antes del verificador) | **~$38 USD** ($1.26/día) |
| **Setup actual** (con el verificador gpt-4o agregado el 13-jun) | **~$55–60 USD** *(estimado, se confirma el lunes)* |

---

## 2. Separación de costo por modelo (medido, 30 días = $18.06 USD)

| Modelo | Costo | Qué corre en él |
|---|---|---|
| **gpt-4o** | **$14.40 (80%)** | El "pensar y conversar": respuestas del nodo, router, respuestas del bot legacy — **+ el nuevo verificador** |
| **gpt-4o-mini** | **$3.60 (20%)** | El "clasificar/parsear rápido": detección de flujo/scope, extracción de medidas, intención de comentarios, contra-entrega/color/frustración/nombre/ubicación |
| gpt-3.5 (residual) | $0.04 (0.2%) | Ruta vieja sobrante, despreciable — marcada para limpieza |

---

## 3. Porcentaje del trabajo por modelo — **las llamadas y el costo divergen**

| Modelo | % de **llamadas** | % del **costo** |
|---|---|---|
| gpt-4o-mini | **83%** (19,255 llamadas) | 20% |
| gpt-4o | **16%** (3,787 llamadas) | **80%** |
| gpt-3.5 | 0.3% | 0.2% |

**Lectura clave (para cotizar):** mini hace la *mayoría del trabajo* (83% de las llamadas) pero es sólo el 20% del gasto. gpt-4o es apenas el 16% de las llamadas pero **el 80% del costo** — porque cuesta ~16× más y hace el trabajo pesado (generar las respuestas reales).
Por eso: bajar los *clasificadores* a mini casi no mueve el costo, y el *generador de respuestas (nodo)* es donde está el dinero — y por eso se mantiene en gpt-4o por calidad.

---

## 4. Volumen actual y costo por conversación

- **~55 conversaciones/día → ~1,650/mes**
- **~174 mensajes de cliente/día** (~3.2 mensajes por conversación)
- **Costo por conversación:** ~**$0.023** medido (antes del verificador) → **~$0.035** setup actual *(estimado)*

---

## 5. Cómo afecta el volumen al costo — **lineal**

El costo escala directo con las conversaciones (~$0.035 c/u, setup actual):

| Conversaciones/mes | ≈ /día | ~$/mes (USD) |
|---|---|---|
| **1,650** (hoy) | 55 | **~$58** |
| 3,000 | 100 | ~$105 |
| 5,000 | 167 | ~$175 |
| 10,000 | 333 | ~$350 |
| 20,000 | 667 | ~$700 |

El doble de conversaciones → el doble de costo. **El volumen es la única palanca grande**; la mezcla de modelos ya está optimizada (clasificadores baratos en mini, generación de respuestas en gpt-4o donde es necesario).

---

## 6. Notas para la cotización al cliente

1. **El ~$0.035/conversación es estimado; la parte del verificador (~30% de ese monto) está proyectada**, no medida — los datos del lunes la fijan. **Recomendación: cotizar a $0.04/conversación** para tener margen y ajustar tras el primer mes.
2. Esto es **sólo el costo de la API de OpenAI** — NO incluye:
   - Hosting (Railway)
   - El dashboard
   - Tu margen
   - Tiempo de asesores humanos en los handoffs
   Esos se suman aparte.
3. **El volumen subió ~4× en dos semanas** (de ~$0.30/día a ~$1.26/día). Las cifras son al volumen actual; si una campaña dispara el tráfico, cotiza el pico, no el promedio.

---

## Decisiones de modelo (contexto)

- **Nodo (respuestas al cliente) + router + verificador → gpt-4o.** Es donde vive la calidad; bajar a un modelo más barato reintroduce los problemas del "modelo tonto" (mala clasificación, prometer cosas que no existen, peor uso de herramientas). El verificador específicamente se probó en mini y **corrompía respuestas válidas**, por eso se mantiene en gpt-4o.
- **Clasificadores/extractores → gpt-4o-mini.** Tareas simples de clasificación; mini es suficiente y ~16× más barato.
- **Killswitch del verificador:** `REPLY_VERIFIER_ENABLED=false` lo desactiva al instante si llega a corromper respuestas.
