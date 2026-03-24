# Flow Registry

Flows must be registered here to be used. If a flow is not listed below, it cannot be used in any convo_flow.

## Model Flows

| Flow | File | Status |
|------|------|--------|
| master_flow | `bot-server/ai/flows/masterFlow.js` | Active |
| retail_flow | `bot-server/ai/flows/retailFlow.js` | Active |
| wholesale_flow | `bot-server/ai/flows/wholesaleFlow.js` | Active |
| buyer_flow | `bot-server/ai/flows/buyerFlow.js` | Active |
| reseller_flow | `bot-server/ai/flows/resellerFlow_v2.js` | Active |
| product_flow | `bot-server/ai/flows/productFlow.js` | Active |
| promo_flow | `bot-server/ai/flows/promoFlow.js` | Active |

## convo_flow Shell

| File | Description |
|------|-------------|
| `bot-server/ai/flows/convoFlow.js` | Base shell — `create(manifest)` returns a convo_flow instance |

## Convo Flows

| Flow | File | Status | Manifest |
|------|------|--------|----------|
| convo_bordeSeparadorRetail | `bot-server/ai/flows/convo_bordeSeparadorRetail.js` | Active | Borde Separador, retail, casual buyer |
| convo_vende_malla | `bot-server/ai/flows/convo_vende_malla.js` | Active | Confeccionada Reforzada Rectangular, wholesale, reseller |
| convo_promo6x4 | `bot-server/ai/flows/convo_promo6x4.js` | Active | Confeccionada Reforzada Rectangular, retail, buyer, promo 6x4 |
