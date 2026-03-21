# product_flow

## What it is
`bot-server/ai/flows/productFlow.js` — model flow for product information retrieval. Does NOT handle sales process (that's retail/wholesale/reseller flows).

## Responsibilities
- Load products from DB (ProductFamily tree, active flag, sellable leaves)
- Match customer requests to available products (AI-driven)
- Detect products we don't offer (early exit list)
- Detect products outside its realm → check other convo_flow manifests
- Provide product data (prices, colors, links, variants, wholesale thresholds) to other flows

## Function: `handle(userMessage, convo, psid, context)`

### Input: context
```js
{
  familyIds: [],         // ProductFamily ObjectIds from manifest
  products: [],          // pre-loaded products (cache, avoids re-querying)
  manifests: []          // other convo_flow manifests for flow switching
}
```

### Returns
- `{ type: 'not_offered', productName, text }` — product we don't sell
- `{ type: 'flow_switch', action: 'product_redirect', targetFlow, targetFlowName }` — product belongs to another flow
- `{ type: 'products_found', products, confidence }` — matched products with all data
- `null` — no match

### Product data shape (what it delivers to other flows)
```js
{
  productId, name, description, price, mlPrice, link, size,
  colors: [], variants: [],
  wholesaleEnabled, wholesaleMinQty, wholesalePrice,
  requiresHumanAdvisor, attributes, imageUrl
}
```

## Exported utilities
- `loadProducts(familyIds)` — loads active products from family tree
- `findProduct(userMessage, products)` — AI matches customer request
- `findFlowForProduct(userMessage, manifests)` — finds another flow for out-of-realm products
- `checkWholesaleThreshold(product, quantity)` — checks if quantity hits wholesale threshold
- `checkNotOffered(userMessage)` — checks "we don't offer" list
- `NOT_OFFERED` — frequently asked products we don't sell (extensible)

## Key rules
- Products are chosen from the product tree; eligible = `active: true` in DB
- Wholesale threshold data is provided but intent detection is retail/wholesale flows' duty
- Dimension parsing is NOT product_flow's job — that's the convo_flow's duty
- When product is outside realm: first check NOT_OFFERED list (early exit), then check other manifests
