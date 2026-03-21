# wholesale_flow

## What it is
`bot-server/ai/flows/wholesaleFlow.js` — model flow for the wholesale sales process. Does NOT handle products (that's product_flow's job).

## Responsibilities
- Data gathering: name, zip code, phone, email (optional), product, quantity
- Catalog/listing presentation (controlled by flags)
- Retail detection → flow_switch to retail
- Handoff to human once all data is collected

## Function: `handle(userMessage, convo, psid, context)`

### Input: context
```js
{
  products: [],                    // from product_flow
  voice: 'professional',           // from manifest (default: professional)
  customerName: string|null,
  clientData: {},                  // already collected fields
  allowListing: boolean,           // whether to list products
  offersCatalog: boolean           // whether to offer a catalog
}
```

### Returns
- `{ type: 'flow_switch', action: 'retail' }` — retail inquiry detected
- `{ type: 'text', text: '...', clientData }` — catalog, next question, or handoff
- `null` — nothing to handle

## Exported utilities
- `extractClientData(userMessage, existingData, options)` — AI extracts client fields
- `detectRetail(userMessage)` — flags retail intent
- `buildCatalogMessage(products, options)` — AI generates catalog presentation
- `CLIENT_FIELDS` — field definitions (key, label, required)

## Key rules
- Asks ALL missing fields in one message, one per line (not one at a time)
- Sales channel is always direct (wholesale doesn't go through ML)
- `allowListing` and `offersCatalog` are separate flags
- Wholesale threshold detection is product_flow's data, but intent detection is this flow's duty
