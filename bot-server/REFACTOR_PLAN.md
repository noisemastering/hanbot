# Bot Intent System Refactor Plan

## Current Problems

### 1. Regex Pattern Hell
`intents.js` is ~1600 lines of if/else chains. Every new case = new pattern.
```javascript
// This doesn't scale
if (/\b(precio|cu[aá]nto|cuesta)\b/i.test(msg)) { ... }
if (/\b(borde|separador)\b/i.test(msg)) { ... }
if (/\b(rol+[oy]s?)\b/i.test(msg)) { ... }
```

### 2. No Semantic Understanding
- "Precio!" alone doesn't tell us WHAT they want priced
- "para que no salga maleza" mentions maleza but isn't asking for groundcover
- Context matters but regex can't understand it

### 3. Scattered State
```javascript
convo.lastIntent        // "roll_query_incomplete"
convo.productInterest   // "rollo"
convo.productSpecs      // { productType: "rollo", width: 2, ... }
convo.humanSalesState   // "asking_quantity"
```
Four different places tracking overlapping things.

### 4. Order-Dependent Routing
If borde check comes before roll check, "rollo de 18m" might trigger borde (18m is a borde length).

### 5. AI Fallback Hallucinates
When patterns fail, AI makes up prices and links.

---

## Proposed Architecture

### Layer 0: Source Context (FIRST)
Before anything else, determine WHERE this conversation came from:

```javascript
convo.source = {
  channel: "facebook" | "whatsapp",
  entryPoint: "ad_click" | "comment" | "direct_message" | "referral",

  // If from ad
  ad: {
    id: "123456",
    campaignId: "789",
    angle: "price_sensitive" | "quality_premium" | "bulk_b2b" | ...,
    product: "malla_sombra" | "borde_separador" | "rollo" | null,
    audienceType: "agricultor" | "hogar" | "negocio",
    offerHook: "Envío gratis" | "20% descuento" | null
  },

  // If from comment
  comment: {
    postId: "456",
    postProduct: "malla_4x5",  // What product was in the post
    sentiment: "interested" | "question" | "complaint"
  },

  // User history
  isReturning: true | false,
  previousProducts: ["rollo", "borde_separador"],
  lastConvoDate: "2024-01-15"
};
```

**Why this matters:**

| Source | Assumption | Tone |
|--------|------------|------|
| Ad: malla beige | They want malla sombra beige | Match ad messaging |
| Ad: borde separador | They want borde | Don't mention malla |
| Ad: bulk/mayoreo | They're B2B | Professional, volume pricing |
| Comment on post | They saw specific product | Reference that product |
| Direct cold message | No context | Ask what they need |
| Returning user | Check history | "¿Sigues interesado en X?" |

**Example flows:**

```
FROM BORDE AD:
User: "Precio!"
→ Source: ad.product = "borde_separador"
→ Skip classifier product detection
→ Route directly to borde flow
→ "¿Qué largo necesitas? 6m, 9m, 18m, 54m"

FROM COLD DM:
User: "Precio!"
→ Source: entryPoint = "direct_message", no ad context
→ No product assumption
→ "¿Qué producto te interesa? Tenemos malla sombra, rollos y borde para jardín"

FROM MALLA AD + RETURNING USER WHO BOUGHT BORDE:
User: "Precio!"
→ Source: ad.product = "malla_sombra", previousProducts = ["borde"]
→ Prioritize ad context (they clicked malla ad)
→ Route to malla flow
```

### Handling Cold Starts (No Ad Context)

When someone messages us directly without clicking an ad, we have less context but NOT zero context:

```
COLD START DECISION TREE:

User sends message
       ↓
┌─────────────────────────────────┐
│  1. Is this a RETURNING user?   │
│     Check: previous convos,     │
│     purchase history            │
└───────────────┬─────────────────┘
                ↓
       ┌────────┴────────┐
       │                 │
      YES               NO
       ↓                 ↓
┌─────────────┐   ┌─────────────────────────┐
│ Check their │   │ 2. Does their MESSAGE   │
│ history:    │   │    mention a product?   │
│ - Last      │   └───────────┬─────────────┘
│   product   │               ↓
│ - Open cart │      ┌────────┴────────┐
│ - Pending   │      │                 │
│   quote     │     YES               NO
└──────┬──────┘      ↓                 ↓
       ↓       ┌───────────┐   ┌───────────────┐
┌─────────────┐│ Classifier │   │ 3. TRULY COLD │
│ Personalize ││ detected   │   │    No context │
│ "¡Hola de   ││ product    │   │    at all     │
│ nuevo! ¿Te  ││ → Route to │   └───────┬───────┘
│ interesa    ││ that flow  │           ↓
│ más [X]?"   │└───────────┘   ┌───────────────┐
└─────────────┘                │ "Hola, ¿qué   │
                               │ producto te   │
                               │ interesa?"    │
                               └───────────────┘
```

**Cold start scenarios:**

| Message | Returning? | Product in msg? | Response |
|---------|------------|-----------------|----------|
| "Hola" | No | No | "Hola, ¿qué producto te interesa?" |
| "Hola" | Yes (bought malla) | No | "¡Hola de nuevo! ¿Te interesa más malla sombra?" |
| "Precio de malla" | No | Yes (malla) | Route to malla flow |
| "Necesito más" | Yes (bought borde) | No | "¿Necesitas más borde separador?" |
| "Buenas tardes" | No | No | "Buenas tardes, ¿qué producto te interesa?" |

**Key principle:** A cold start isn't truly "cold" if:
1. They're a returning user (we have history)
2. Their message mentions a product (classifier detects it)

Only when BOTH are missing do we need to ask "¿Qué te interesa?"

### Layer 1: Intent Classifier (AI-based)
One call to classify the message into a clear intent:

```javascript
const intents = [
  "greeting",
  "price_query",           // Wants to know price
  "product_inquiry",       // Asking about a product
  "size_specification",    // Providing dimensions
  "percentage_specification", // Providing shade %
  "quantity_specification",   // Providing quantity
  "color_query",
  "shipping_query",
  "location_query",
  "payment_query",
  "installation_query",
  "human_request",         // Wants to talk to human
  "confirmation",          // "si", "ok", "esa"
  "rejection",             // "no", "otra"
  "unclear"                // Can't determine
];

const products = [
  "malla_sombra",          // Confeccionada (pre-made sizes)
  "rollo",                 // Rolls (100m)
  "borde_separador",       // Garden edging
  "groundcover",           // Anti-weed fabric
  "unknown"
];
```

**Single AI call extracts:**
```javascript
{
  intent: "price_query",
  product: "rollo",
  entities: {
    width: 2.1,
    length: 100,
    percentage: 90,
    quantity: 15,
    color: "negro"
  },
  confidence: 0.92
}
```

### Layer 2: Unified Conversation State
One clear state object:

```javascript
convo.flow = {
  product: "rollo",              // Current product context
  stage: "awaiting_percentage",  // Where we are in the flow
  collected: {                   // What we've gathered
    width: 2.1,
    length: 100,
    percentage: null,
    quantity: null,
    color: null
  },
  pendingQuestion: "percentage"  // What we last asked
};
```

### Layer 3: Product Flows (State Machines)
Each product has a clean, isolated flow:

```
ROLLO FLOW
┌─────────────┐
│   START     │
└──────┬──────┘
       ▼
┌─────────────┐    has width?     ┌─────────────┐
│ ASK_WIDTH   │ ───────────────▶  │ASK_PERCENT  │
└─────────────┘                   └──────┬──────┘
                                         │ has %?
                                         ▼
                                  ┌─────────────┐
                                  │ ASK_QUANTITY│ (optional)
                                  └──────┬──────┘
                                         ▼
                                  ┌─────────────┐
                                  │  COMPLETE   │ → Hand off
                                  └─────────────┘
```

```
BORDE FLOW
┌─────────────┐
│   START     │
└──────┬──────┘
       ▼
┌─────────────┐    has length?    ┌─────────────┐
│ ASK_LENGTH  │ ───────────────▶  │ SHOW_LINK   │
│ (6,9,18,54) │                   └─────────────┘
└─────────────┘
```

```
MALLA CONFECCIONADA FLOW
┌─────────────┐
│   START     │
└──────┬──────┘
       ▼
┌─────────────┐    has size?      ┌─────────────┐
│  ASK_SIZE   │ ───────────────▶  │ SHOW_PRICE  │
└─────────────┘                   │  + LINK     │
                                  └─────────────┘
```

### Layer 4: Response Generator
Takes (intent, product, state, entities) → generates response

```javascript
function generateResponse(classification, convo) {
  const { intent, product, entities } = classification;
  const flow = convo.flow;

  // Get the appropriate flow handler
  const handler = flowHandlers[product || flow.product || 'general'];

  // Let the flow handle it
  return handler.handle(intent, entities, flow);
}
```

---

## File Structure

```
ai/
├── context/
│   ├── sourceDetector.js      # Layer 0: Detect channel, entry point, ad context
│   ├── adContextMapper.js     # Map ad IDs → product, angle, audience
│   └── userHistory.js         # Check returning user, previous purchases
├── classifier/
│   ├── intentClassifier.js    # Layer 1: AI-based intent + entity extraction
│   └── prompts.js             # Classification prompts
├── flows/
│   ├── index.js               # Layer 2: Flow router
│   ├── rolloFlow.js           # Roll state machine
│   ├── bordeFlow.js           # Borde state machine
│   ├── mallaFlow.js           # Confeccionada state machine
│   ├── groundcoverFlow.js     # Groundcover state machine
│   └── generalFlow.js         # Generic queries (shipping, location, etc.)
├── entities/
│   └── entityExtractor.js     # Backup regex extraction if AI misses
└── index.js                   # Main entry point
```

## Overall Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        INCOMING MESSAGE                          │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 0: SOURCE CONTEXT                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │  Channel?   │ │ Entry point?│ │  Ad context?│               │
│  │ FB/WhatsApp │ │ Ad/Comment/ │ │ Product,    │               │
│  │             │ │ DM/Referral │ │ Angle, Tone │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                         ↓                                       │
│  convo.source = { channel, entryPoint, ad, isReturning }       │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: INTENT CLASSIFIER (AI)                                │
│                                                                  │
│  "90%" + source.ad.product="rollo" + flow.stage="awaiting_%"   │
│                         ↓                                       │
│  { intent: "percentage_spec", product: "rollo",                │
│    entities: { percentage: 90 }, confidence: 0.95 }            │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: FLOW ROUTER                                           │
│                                                                  │
│  product = classification.product                               │
│         || convo.source.ad?.product                             │
│         || convo.flow?.product                                  │
│         || "general"                                            │
│                         ↓                                       │
│  Route to: rolloFlow / bordeFlow / mallaFlow / generalFlow     │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: PRODUCT FLOW (State Machine)                          │
│                                                                  │
│  rolloFlow.handle(intent, entities, convo.flow)                │
│                         ↓                                       │
│  - Update flow state                                            │
│  - Determine next question or complete                          │
│  - Generate response with correct tone (from source.ad.angle)  │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         RESPONSE                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

### Phase 1: Source Context (Layer 0)
- Build `sourceDetector.js` - detect channel, entry point
- Build `adContextMapper.js` - map ad IDs to product/angle/audience
- Build `userHistory.js` - check returning users
- **This is foundational** - everything else depends on knowing context
- Log source context for all conversations for 1 week

### Phase 2: Intent Classifier (Layer 1)
- Build `intentClassifier.js`
- Log classifications alongside current system
- Compare accuracy with source context included
- Tune prompts based on real data

### Phase 3: Build Flows (Layer 2-3)
- Create flow handlers for each product
- Start with `rolloFlow.js` (most complex)
- Then `bordeFlow.js`, `mallaFlow.js`, `groundcoverFlow.js`
- Test with subset of users
- Keep old intents.js as fallback

### Phase 4: Switch Over
- Route through new system
- Old intents.js becomes emergency fallback
- Monitor for regressions

### Phase 5: Cleanup
- Remove old intents.js
- Remove scattered state fields
- Consolidate to `convo.source` + `convo.flow`

---

## Example: How "Precio!" Would Work

**Current (broken):**
1. "Precio!" doesn't match specific patterns
2. Falls to AI fallback
3. AI sees borde in history, hallucinates $599

**New system:**
1. Classifier returns: `{ intent: "price_query", product: "unknown", entities: {} }`
2. Router checks `convo.flow.product` → "borde_separador"
3. Borde flow handles: "¿Qué largo necesitas? 6m, 9m, 18m, 54m"

**Or if no product context:**
1. Classifier returns: `{ intent: "price_query", product: "unknown", entities: {} }`
2. No `convo.flow.product` set
3. General flow: "¿Qué producto te interesa? Tenemos malla sombra, rollos y borde para jardín"

---

## Example: How "90%" Would Work

**Current (broken):**
1. User said "rollo 2x100" earlier
2. Bot asked for percentage
3. User says "90%"
4. "90%" doesn't contain "rollo" → doesn't route to rollQuery
5. Falls through to wrong handler

**New system:**
1. Classifier returns: `{ intent: "percentage_specification", entities: { percentage: 90 } }`
2. `convo.flow = { product: "rollo", stage: "awaiting_percentage", collected: { width: 2 } }`
3. Rollo flow receives percentage → moves to next stage or completes

---

## Estimated Effort

| Phase | What | Effort | Risk |
|-------|------|--------|------|
| Phase 1 | Source Context (Layer 0) | 2 days | Low (additive, logging only) |
| Phase 2 | Intent Classifier (Layer 1) | 2-3 days | Low (parallel to current) |
| Phase 3 | Product Flows (Layer 2-3) | 4-5 days | Medium |
| Phase 4 | Switch Over | 1 day | Medium |
| Phase 5 | Cleanup | 1 day | Low |

Total: ~2 weeks for a solid foundation that won't need constant patching.

**Note:** Phases 1-2 are non-breaking. We're just adding logging and running in parallel. Risk only increases at Phase 4 when we actually switch over.

---

## Decision Points

1. **Which AI model for classification?**
   - GPT-3.5-turbo (fast, cheap) vs GPT-4o-mini (smarter)
   - Could even use a fine-tuned small model later

2. **How to handle classifier failures?**
   - Fallback to regex?
   - Ask for clarification?

3. **Migrate all products at once or one by one?**
   - Recommend: Start with rollo (most complex), then others

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] **Phase 1:** Build source context detection
   - [ ] `sourceDetector.js` - channel + entry point detection
   - [ ] `adContextMapper.js` - map ad IDs to product/angle
   - [ ] `userHistory.js` - returning user detection
   - [ ] Log source context for all convos (1 week)
3. [ ] **Phase 2:** Build intent classifier
   - [ ] `intentClassifier.js` with AI-based classification
   - [ ] Log classifications in parallel with current system
   - [ ] Compare accuracy, tune prompts
4. [ ] **Phase 3:** Build product flows
   - [ ] `rolloFlow.js` (start here - most complex)
   - [ ] `bordeFlow.js`
   - [ ] `mallaFlow.js`
   - [ ] `groundcoverFlow.js`
   - [ ] `generalFlow.js`
5. [ ] **Phase 4:** Switch over with fallback
6. [ ] **Phase 5:** Cleanup old code
