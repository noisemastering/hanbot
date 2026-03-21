# masterFlow Architecture

## What it is
`bot-server/ai/flows/masterFlow.js` — a model_flow. 100% AI-driven, no regex. Handles general questions (location, schedule, payment, generic store link, etc.). Sits above everything else. Called by convo_flows, never drives a conversation alone.

## Function: `handle(userMessage, convo, psid, context)`

### Input: context
```js
{
  salesChannel: 'mercado_libre' | 'direct',  // determines payment/shipping details
  installationNote: string|null,              // optional extra note for installation answers
}
```

No product name, no flow type — master_flow does not know about specific products.

### AI System Prompt Contents
1. **Role**: Asesora de ventas de Hanlob, fabricante de malla sombra
2. **Sales channel block** (conditional on `salesChannel`):
   - `mercado_libre`: ML payment (tarjeta, OXXO, transferencia, meses sin intereses), envío incluido, compra protegida, factura automática
   - `direct`: transferencia/depósito, envío por paquetería (costo depende de ubicación), factura directa
3. **Business data**: ubicación (Querétaro, Navex Park, Tlacote), dirección, Google Maps link, teléfono, WhatsApp, horario (Lun-Vie 8am-6pm), envío a México y EEUU, 5+ años fabricantes
4. **After hours note** (conditional): si necesita especialista, le contactarán el siguiente día hábil
5. **Payment rules**: NUNCA pago contra entrega, SIEMPRE "100% por adelantado"
6. **Installation**: No servicio de instalación + optional `installationNote`

### Classification (JSON response from GPT-4o-mini)
1. `{ "type": "handoff", "reason": "..." }` — customer wants a human → executes handoff
2. `{ "type": "response", "text": "...", "intent": "..." }` — general question answered directly
   - Intents: `phone_request`, `trust_concern`, `pay_on_delivery`, `location`, `shipping`, `payment_method`, `invoice`, `installation`, `farewell`, `general`
3. `{ "type": "product_specific" }` — returns `null`, calling flow handles it

### Rules in the prompt
- Español mexicano, amable, conciso (2-4 oraciones máx)
- Never invent prices or dimensions
- Never include URLs except Google Maps (for location) and WhatsApp (when sharing phone)
- When in doubt between general and product_specific → always product_specific
- JSON only, nothing else

### Context passed to AI
- Customer name (if known)
- Whether a purchase link was already shared
- Last bot response (truncated to 120 chars)

### Return values
- `{ type: "text", text: "..." }` — for handoff or response
- `null` — for product_specific (let calling flow handle it)
- `null` — on error (fail open, let calling flow try)

## How convo_flows use this
Convo_flows **import and call** `masterFlow.handle()`. They do NOT copy/embed its logic. Master_flow is a lego piece — convo_flows compose it with other model_flows.

## Rules
- NEVER modify masterFlow unless explicitly instructed
- masterFlow is the SOURCE OF TRUTH for general question handling
- convo_flows that add extra classification rules (e.g. purchase intent, installation insistence) do so in their own layer, not by modifying masterFlow
