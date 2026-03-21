# Flow Architecture

## Flow Types

There are three types of flows. Not all flows can drive a conversation.

| Type | Can drive a conversation? | Description |
|------|--------------------------|-------------|
| **master flow** | No (only via convo_flow) | Sits above everything. Handles general questions. |
| **model_flow** | No (only via convo_flow) | Reusable building blocks. Each handles a specific concern. |
| **convo_flow** | **Yes** | The only type that can have a conversation. Assembled from model_flows + master flow. |

## General Rules

- **All flows must be stored in the database.** Flow definitions, manifests, and configuration live in the DB, not hardcoded.

## convo_flow Rules

- A convo_flow file name must start with `convo_` (e.g. `convo_mallaRetail.js`, `convo_promo6x4.js`).
- A convo_flow's manifest must state `type: 'convo_flow'`.
- A convo_flow **must** contain:
  1. A **manifest**
  2. A **master_flow**
  3. A **product_flow**
  4. Either a **retail_flow** or a **wholesale_flow** (or both)
  5. Either a **buyer_flow** or a **reseller_flow** (or both)
- There is no master_convo exception. The general/cold-start flow is `convo_general`, which has the same structure as any other convo_flow.
- All convo_flows can **call another convo_flow** if the situation requires it. Once the new flow takes over, it can call another flow or go back to the previous one.
- A convo_flow contains a **manifest** which describes: which products it handles, client profile, and whether it's retail or wholesale. When a product_flow detects the need to change to another flow, it checks the others' manifests to determine the best flow to hand over to.
- A convo_flow maintains a **product basket** (shopping cart). It is an array of items the client has asked for. Usually 1 item, sometimes 2-3. The basket must never lose track of items across flow transitions or message handling. Each item in the basket:
  ```js
  { productId, description, price, quantity: 1 } // quantity defaults to 1
  ```

## Model Flows

### 1. master_flow
Stands above everything else. Holds general questions: location, schedule, payment, generic store link, etc.

### 2. retail_flow
Handles all conversations for products that can be sold through any of our online stores (currently only Mercado Libre, but will expand to Amazon, Walmart, etc.). Must:
- Answer for the products within its realm
- Provide a purchase link when quoting
- Identify a product or variant that needs a human to take over

### 3. wholesale_flow
Handles all products that, by nature or by volume, must be sold as wholesale. A wholesale flow may or may not offer a catalog. Must gather from the client:
- Name
- Zip code
- Phone number
- Email (if available)
- Specific product (when variants are offered)
- Quantity

### 4. promo_flow
Holds a special offer of a specific product or products. Also holds timeframes for the promo and terms & conditions if any. Must:
- Present the products right away
- Switch off if the client is not interested in that specific set of products, letting the rest of the flow carry on with the conversation
- Retrieve prices from the database on most cases, but has the ability to hold its own prices if they're set

### 5. buyer_flow
Treats the person as the end buyer — the one that enters the store and asks for product features and wants to buy stuff for himself. Can buy retail but may buy wholesale (e.g. a contractor who buys wholesale but won't resell — an end user). Must:
- Differentiate between a casual buyer and a technical one, depending on the character set for the AI

### 6. reseller_flow
For wholesale, but people in this flow are looking to resell whatever product the flow is paired with. Must treat the person as someone looking to make business. Most reseller flows will offer a catalog. Must collect:
- Name
- Zip code
- Phone number
- Email
- Products and quantities
- Then hand it over to the human

### 7. product_flow
In charge of retrieving all available information about the products it handles. Must:
- Understand variants
- Be very aware of products we don't offer
- Retrieve prices, available colors, and links
- Know the wholesale threshold of each product it offers
- Recognize whenever a client is interested in another product outside of its realm and call the proper flow

### 8. convo_flow (the shell)
The empty carcass. Holds combinations of the model flows listed above. Contains a **manifest**:
- Which products it handles
- Client profile
- Whether it's retail or wholesale

The manifest allows product_flow to determine the best convo_flow to hand over to when a product change is detected.

## Composition

All flows are like legos. They must communicate with each other once they're put together into a convo_flow.

```
convo_flow = manifest + master_flow + product_flow + (retail_flow | wholesale_flow) + (buyer_flow | reseller_flow) + [optional: promo_flow]
```

Examples:
```
convo_mallaRetail   = manifest + master_flow + product_flow(malla) + retail_flow + buyer_flow(casual)
convo_rolloReseller = manifest + master_flow + product_flow(rollo) + wholesale_flow + reseller_flow
convo_promo6x4      = manifest + master_flow + product_flow(malla) + retail_flow + buyer_flow(casual) + promo_flow
convo_general       = manifest + master_flow + product_flow(all) + retail_flow + buyer_flow(casual)
```
