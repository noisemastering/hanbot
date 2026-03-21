# reseller_flow

## What it is
`bot-server/ai/flows/resellerFlow_v2.js` — model flow for the reseller sales process. Treats the person as someone looking to make business.

> **TODO:** Rename to `resellerFlow.js` once the current `resellerFlow.js` is retired.

## Responsibilities
- Investment pitch: stresses business opportunity, being a manufacturer = better prices
- Data gathering: name, zip code, phone, email, products, quantities
- Catalog/listing presentation (controlled by flags)
- Buyer detection → flow_switch to buyer
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
  offersCatalog: boolean,          // whether to offer a catalog
  pitchSent: boolean               // whether the reseller pitch has been delivered
}
```

### Returns
- `{ type: 'flow_switch', action: 'buyer' }` — end-buyer detected
- `{ type: 'text', text: '...', pitchSent, clientData }` — pitch, question, or handoff
- `null` — nothing to handle

## Exported utilities
- `extractClientData(userMessage, existingData, options)` — AI extracts client fields
- `detectBuyer(userMessage)` — flags end-buyer intent
- `buildResellerPitch(products, options)` — AI generates business opportunity pitch
- `CLIENT_FIELDS` — field definitions

## Key rules
- Mentions investment value, manufacturer advantage, product quality for resale
- Does NOT promise exclusivity or specific margins
- Asks ALL missing fields in one message, one per line
- Pitch is delivered on first interaction, then moves to data gathering
