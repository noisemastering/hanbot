# retail_flow

## What it is
`bot-server/ai/flows/retailFlow.js` — model flow for the retail sales process. Does NOT handle products (that's product_flow's job).

## Responsibilities
- Quoting with AI-generated human-like messages
- Presenting purchase links (from product_flow data)
- Handoff rules (coded per product type, e.g. oversized confeccionada)
- Wholesale detection → flow_switch to wholesale

## Function: `handle(userMessage, convo, psid, context)`

### Input: context
```js
{
  products: [{ productId, name, description, price, link, colors, variants }],  // from product_flow
  voice: 'casual' | 'professional' | 'technical',  // from manifest
  salesChannel: 'mercado_libre',                     // ready for 'amazon', 'walmart'
  customerName: string|null
}
```

### Returns
- `{ type: 'flow_switch', action: 'wholesale' }` — wholesale inquiry detected
- `{ type: 'text', text: '...' }` — handoff or AI-generated quote
- `null` — nothing to handle

## Exported utilities
- `checkHandoffRules(product)` — evaluates coded handoff rules
- `detectWholesale(userMessage)` — flags wholesale intent
- `buildQuoteMessage(products, options)` — AI generates quote message
- `HANDOFF_RULES` — array of coded rules, extensible

## Key rules
- Products come FROM product_flow, retail_flow only presents them
- Links come FROM product_flow, retail_flow only delivers them
- Voice is set by the convo_flow manifest
- Currently ML only, structure ready to expand to Amazon/Walmart
