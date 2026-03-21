# convo_flow Structure

## What it is
The only flow type that can drive a conversation. It's the shell that assembles model flows together. Every convo_flow has the same mandatory structure — there are no exceptions.

## Mandatory components
Every convo_flow **must** contain:

1. **Manifest** — stored in DB, describes the flow
2. **master_flow** — handles general questions
3. **product_flow** — handles product retrieval and matching
4. **retail_flow OR wholesale_flow** (or both) — handles the sales process
5. **buyer_flow OR reseller_flow** (or both) — handles the client persona

Optional:
- **promo_flow** — special offers (when applicable)

## Manifest
```js
{
  type: 'convo_flow',              // mandatory identifier
  name: string,                     // e.g. 'convo_mallaRetail'
  products: [],                     // ProductFamily IDs this flow handles
  clientProfile: 'buyer' | 'reseller',
  salesChannel: 'retail' | 'wholesale',
  voice: 'casual' | 'professional' | 'technical',
  // ... additional config per flow
}
```

The manifest allows product_flow to determine the best convo_flow to hand over to when a product change is detected.

## Product basket
Every convo_flow maintains a product basket (shopping cart):
```js
[{ productId, description, price, quantity: 1 }]  // quantity defaults to 1
```
- Usually 1 item, sometimes 2-3
- Must never lose track of items across flow transitions or message handling

## Naming
- File name must start with `convo_` (e.g. `convo_mallaRetail.js`, `convo_promo6x4.js`)
- Must be registered in `FLOW_REGISTRY.md` to be used

## Flow switching
- All convo_flows can call another convo_flow if the situation requires it
- Once the new flow takes over, it can call another flow or go back to the previous one

## convo_general
The general/cold-start flow. Same structure as any other convo_flow — no exceptions. Replaces the old master_convo concept.

## Dimension parsing
Dimension/custom size parsing is the convo_flow's responsibility, NOT product_flow's.
