# Flow-Switching Protocol

All flow switches must follow these protocols exactly. No shortcuts or simplifications.

## 1. Different Product

When the client asks for a product that is not in the current flow's product list.

1. Is certain that the client asked for a product
2. Is certain that the product asked for is not in the current product list
3. The product in question exists on another flow (could be 1 or more flows)
4. Offers the product name and — if present on more than one flow — the alternatives that those flows offer (e.g. retail/wholesale, buyer/reseller)
5. When the client confirms, calls the right flow with `comesFromFlowSwitch: true`

If the product doesn't exist on any flow → tell the client we don't offer it.

## 2. Different Voice (Buyer ↔ Reseller)

When the product is correct but the client's intent matches a different persona.

1. Is certain the product is available on another manifest with the intended voice → switch seamlessly (no confirmation needed)
2. If the product exists but is NOT available with the intended voice → hand off to human

## 3. Different Quantity (Retail ↔ Wholesale)

When the product is correct but the quantity crosses the wholesale threshold.

1. Is certain that the product matches the current one
2. Wholesale threshold is above or below (depending on the initial direction)
3. Switches seamlessly (no confirmation needed)

## 4. Different Dimensions / Presentation

When the product description is correct but dimensions don't match.

1. The basic features are correct but the client asks for a different presentation. Most common example: asking for Confeccionada in a Rollo flow
2. The product exists but dimensions are out of range and the parser can't extrapolate a coherent size, OR dimensions match another product from the same family. Most common case: Confeccionada and Rollo are the same product in different presentation
3. Dimensions match another product from the same family → switch to the flow that handles that presentation

## General Rules

- **Seamless switches** (voice, quantity, dimensions within family): no confirmation needed, no greeting, `comesFromFlowSwitch: true`
- **Product switches** (different product altogether): requires confirmation from the client before switching
- **All switches** set `comesFromFlowSwitch: true` on the target flow's state
- **Basket**: carry over the product basket to the new flow. Never lose items.
- **Client data**: carry over any collected client data (name, zip, phone, etc.)
- **If no valid target flow exists**: hand off to human
