# promo_flow

## What it is
`bot-server/ai/flows/promoFlow.js` — model flow for special offers/promotions. Presents promo products right away, can override prices, has timeframes and terms & conditions. Switches off if client is not interested.

## Responsibilities
- Present promo products immediately (first message)
- Override product_flow prices when promo-specific prices are set
- Track promo timeframe (auto-expire or "hasta agotar existencias")
- Provide terms and conditions
- Detect disinterest → return null, let convo_flow continue normally

## Function: `handle(userMessage, convo, psid, context)`

### Input: context
```js
{
  products: [],                    // from product_flow
  voice: 'casual',                 // from manifest
  salesChannel: 'mercado_libre' | 'direct',  // can be retail or wholesale
  customerName: string|null,
  promoPrices: [{ productId, price }],  // override prices (optional)
  timeframe: { startDate, endDate },    // null = hasta agotar existencias
  terms: string|null,                    // null = use default T&C
  pitchSent: boolean                     // whether promo has been presented
}
```

### Returns
- `{ type: 'text', text: '...', pitchSent: true, products }` — promo presentation
- `{ type: 'text', text: '...' }` — terms and conditions
- `null` — promo expired, client not interested, or already presented (let convo_flow continue)

## Default terms and conditions
- Precios y disponibilidad sujetos a cambio sin previo aviso
- Válida hasta agotar existencias (or set date)
- No acumulable con otras promociones
- Aplica únicamente para los productos incluidos en la promoción
- Envío no incluido en el precio promocional (salvo que el canal de venta lo incluya)

## Exported utilities
- `checkTimeframe(timeframe)` — returns `{ active, expiryText }`
- `applyPromoPrices(products, promoPrices)` — overrides product prices
- `detectNotInterested(userMessage)` — flags disinterest
- `buildPromoPitch(products, options)` — AI generates promo presentation
- `DEFAULT_TERMS` — default terms text

## Key rules
- If no timeframe is set, promo remains active; default text: "Hasta agotar existencias"
- Promo prices override product_flow prices when set
- Uses existing purchase links (no special promo links)
- Can be retail or wholesale
- Switches off (returns null) when client is not interested
- Terms stored in the promo_flow itself; default generic text used when none set
