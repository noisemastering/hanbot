# Claude Code Project Notes

## Project Map (read this first)

**What it is:** a MX-Spanish sales bot for **Hanlob** (malla sombra / shade cloth) on **Facebook Messenger + WhatsApp**, plus a **React dashboard**. Ad clicks (click-to-Messenger / CTWA) enter the bot; it quotes products, shares Mercado Libre purchase links, and hands off to a human when needed. A correlation system attributes ML sales back to conversations.

**Two apps, one repo:**
- `bot-server/` — Node/Express backend (bot + API). Deploys to **Railway**.
- `dashboard/` — React app (analytics, conversations, Spec Ops). Deploys to **Vercel**.

**The bot brain (where most fixes go):**
- `bot-server/ai/index.js` — pipeline entry (persona, runs the engine).
- `bot-server/ai/workflow/index.js` — the **workflow engine**: per-turn logic = deterministic gates (borde, color, quantity, flow-switch, greeting…) that run BEFORE the LLM turn; a gate can short-circuit with a reply. Most bot behavior fixes land here.
- `bot-server/ai/workflow/setupContext.js` — builds the LLM system prompt (per-flow directives, promo preload, product knowledge).
- `bot-server/ai/workflow/tools.js` — the AI product-scope classifier (verdicts: `no_product|current|other_flow|needs_human|not_sold`) + measure/quantity parsing (`dimsOf`, `stripMeasures`, `qtyFromText`, `orderedQty`, `wantsWholesale`). **All measure/qty parsing MUST go through these — never a raw `\d+(x|por)\d+`.**
- **Active product flows are `Workflow` docs in Mongo** (reforzada confeccionada, sin refuerzo, rollo, borde separador, ground cover, complementos, cold-start) — inspect via the DB, not only files. Legacy flows (`ai/flows`, `ai/core`, the `*_FLOW.md` docs) coexist, but ad traffic runs on the workflow engine.

**Correlation (convo↔sale attribution):** `bot-server/utils/convoSaleMatcher.js` (tiered `classify()`), `runConvoCorrelation.js` (runner), `scripts/correlationHealthCheck.js` (17 invariants). Reads our OWN DB (ml_sales + conversations + clicks).

**Data:** production MongoDB Atlas (free-tier M0, ~512 MB cap). **The local server connects to the SAME prod DB** — be careful with writes/backfills.

## User Preferences

**Don't suggest hard refresh.** The user always does this already. When debugging UI issues, skip directly to checking API responses, deployment status, or code issues.

**Restart the local bot-server automatically** whenever backend code changes are made. The user tests on localhost - always restart the server after modifying bot-server files. Don't ask, just do it.

## Bot Behavior Directive

**The bot must behave like a human, never like a bot.**

- NEVER force users to respond with numbers, codes, or specific formats
- ALWAYS understand natural language responses (e.g., "50 y 70%" instead of "2 y 3")
- NEVER say things like "Please select a number between 1 and 4" or "Reply with the option number"
- Parse user intent intelligently - if they express what they want, understand it
- Handle typos, informal language, and variations gracefully
- If the bot can't understand, ask naturally: "¿Cuál te interesa?" not "Invalid input, please try again"
- Conversations should flow naturally, not feel like filling out a form
- The bot represents a real business - it should feel like texting with a helpful salesperson, not a phone tree menu

**NEVER dump long product lists:**
- When listing products, ALWAYS check the count first
- If more than 3 options: show "desde X hasta Y" (smallest to largest)
- NEVER join all product names with " y " without checking count
- NEVER do `products.map(p => p.name).join()` on unbounded queries
- ProductFamily queries MUST filter by `parentId: null` for catalog overviews
- Any query that could return many items needs a limit or range display

## Communication Rules

**Always ask before acting.** When the user describes a problem, requirement, or structure, ask: "Do you want me to code this or just explain it?" Never assume — the user may want documentation, code, or both. Act only on what they confirm.

## Architecture

**Before creating or modifying any flow, READ these files first:**
- `FLOW_ARCHITECTURE.md` — flow types (master, model, convo), composition rules, model flow definitions
- `FLOW_REGISTRY.md` — registry of all flows. A flow MUST be registered here to be used.
- `MASTER_FLOW.md` — masterFlow structure, prompt contents, classification logic
- `RETAIL_FLOW.md` — retail sales process, quoting, purchase links
- `WHOLESALE_FLOW.md` — wholesale sales, data gathering, catalog
- `BUYER_FLOW.md` — end-buyer persona layer (casual/technical)
- `RESELLER_FLOW.md` — reseller sales, investment pitch, data gathering
- `PRODUCT_FLOW.md` — product retrieval, matching, out-of-realm detection
- `PROMO_FLOW.md` — promo special offers, timeframes, terms, price overrides
- `CONVO_FLOW.md` — convo_flow structure, mandatory components, manifest, product basket
- `FLOW_SWITCHING_PROTOCOL.md` — 4 switching scenarios, seamless vs confirmed, state carry-over

Follow these documents exactly. Do not deviate, simplify, or merge architectures described in them.

## Dual Channel Rule

**This bot runs on TWO channels: Facebook Messenger AND WhatsApp.** When wiring any ad-related feature, flow routing, or conversation field, you MUST update BOTH entry paths:

- **Facebook Messenger**: `bot-server/index.js` (referral/webhook handling)
- **WhatsApp CTWA**: `bot-server/channels/unified/processor.js` (WhatsApp ad-entry handling)

Never say a feature is "wired up" until both paths are verified. Grep for all places that set the relevant field to ensure nothing is missed.

## Deployment Rules

**CRITICAL: The user NEVER changes configuration on Railway or Vercel.**

This is a safety measure to guarantee the project's integrity. If deployment errors occur that suggest configuration issues (like "Could not find root directory"), do NOT:
- Suggest the user modify Railway/Vercel dashboard settings
- Add railway.json, railway.toml, vercel.json or similar config files
- Assume the user misconfigured something

Instead:
- Check if recent code changes could have caused the issue
- Look for syntax errors, missing files, or broken imports
- The deployment configuration that exists is correct and should not be touched

## Common Commands (run from `bot-server/`)

- **Restart local server** (do after every backend change — the user tests on localhost):
  `pkill -f "node.*index.js"; sleep 1; node index.js` — boots on `:3000`, connects to prod Mongo. Confirm with the `🚀 Server is running` / `✅ Connected to MongoDB Atlas` log lines.
- **Deploy backend + dashboard:** `git add -A && git commit -m "…" && git push origin main`. Railway auto-deploys `bot-server` from `main`, Vercel auto-deploys `dashboard`. **One push ships both.** End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.
- **Daily convo QA audit:** `node scripts/convoAudit.js <ISO_DATE>` — LLM-judges every bot reply since the cutoff (categories: nonsense / precio / link / negacion_falsa / descuento_vago / multimedida / impermeable / nombre) + a deterministic handoff scan. Context is session-scoped (drops >12h-idle history). Watch for false positives on borde/rollo "precio" openers (the judge lacks flow context).
- **Borde message reader (fast, no DB/LLM/network):** `node scripts/bordeOrderTest.js` — 42 cases over `ai/workflow/bordeOrder.js`, the ONE function that decides what a number in a borde message means (count vs. presentation vs. measurement vs. C.P.). **Run this before touching any borde gate.** Reading numbers anywhere else in the borde flow is how the same "N was read as a quantity" bug shipped SIX separate times — the file header lists them. The sixth got past the rewrite itself: "las dos versiones" counted our OPTIONS, so a number bound to a non-roll noun (versiones, opciones, medidas, colores, años, jardines) is now stripped before any count is read.
- **Price rule without a live listing (fast, no DB/LLM/network):** `node scripts/priceRuleTest.js` — 25 cases. **No live listing — no ML link, OR a link whose listing has no price (paused / 404) — ⇒ the PRICE SHEET (`price`) decides**, quoted + handoff, with a dead link withheld. **No sheet price either ⇒ handoff with NO price quoted.** The cached `mlPrice` is NEVER quoted in these cases: it is the price of the very listing that is gone. It survives only as a live-listing stand-in when ML is briefly unreachable, and the "inventario below last ML price" guard applies only there.
- **ROLLO COMPLETO (2026-10-23, the client's call).** A full roll — any 100 m roll (`…X100` in `productCode`) and the borde's 54 m — is quoted from the PRICE SHEET with **IVA folded into the amount**, carries **NO Mercado Libre link**, and **always hands off** so an asesor closes it and quotes the freight. It is the one case where the live ML price does NOT win: our ML listing for Ground Cover 4x100 m charged $5,314 while the direct price is $4,222.40 ($3,640 + IVA), and the customer who had both numbers answered "juegan por sus precios". Cut pieces (GC 2x50, borde 18 m) are unchanged and still self-serve with their link. The 47 m UV cord roll is deliberately excluded. Predicate: `resolveIsFullRoll` in `priceResolver.js` — it reads `productCode`/the parent name ITSELF rather than trusting the caller's `.select()`, because the sellable leaf is named just "Negro" and almost no gate projects `productCode`.
- **Every price the bot says goes through `fmtMoney(pi)`** (`priceResolver.js`) — it owns "+ IVA" vs "(IVA incluido)" vs plain, and the cents. 27 call sites used to write that by hand. `index.js` imports it at MODULE scope on purpose: the per-gate `require("./priceResolver")` destructures vary, and two gates referenced it without it in scope, throwing into a try/catch that silently turned a quote into "esa medida no está disponible".
- **Three facts the bot had nowhere to read (2026-10-23).** (1) **Grado de protección = % de sombra** — the client's words: "the protection degree is a basic feature of the product". It was in NO workflow's knowledge and NO prompt, so a batched "grado de protección y tiempo de garantía" could only answer the garantía half. Stated company-wide in `setupContext.js` next to garantía: Raschel 35/50/70/80/90% (all five verified sellable with live ML links), confeccionada always 90%, ground cover not measured in shade % at all. (2) **An ÁREA is a surface, so it can only be malla sombra** — "5 metros cuadrados" was answered with a Borde Separador 54 m roll, a product sold by the LINEAR metre, with a buy link. `dimsOf("5 metros cuadrados")` is null, so no gate claimed the turn and the model picked the realm. (3) **Customers name colors by tone** — "la oscura"/"la clarita" are a color request; `oscur[oa]`/`clar[oa]` are in `COLORW` (§1.087) so the turn LISTS the real dark colors with their prices instead of guessing, and beige — the default in several paths — can never win by silence.
- **A bare PRICE ask is not a bare SIZE ask (ground cover, 2026-10-23).** The client's rule: "if we are talking about rolls then options narrow down and it's possible to quote all of them because they are like 2". GC's catalogue is 8 sizes, but only **2x100 and 4x100 are full rolls**, so a price ask with no measure quotes BOTH with exact prices through `resolvePrice` (⇒ ROLLO COMPLETO: IVA folded in, no ML link, asesor closes and quotes freight) plus one clause that 10/25/50 m cuts exist. "¿Qué medidas manejan?" keeps the `desde X hasta Y` size list. The trap: `asksWhichSizes` accepts "rollos"/"opciones", so **"¿qué precio tienen los rollos?" used to take the size-list path** — the size list now only wins when the message names *medidas/tamaños/dimensiones/anchos/largos*.
- **The color choice is ONE helper, inventory-wide: `colorChoiceForProduct` / `colorChoiceText` (`priceResolver.js`).** The client's rule generalized: where a size's colors cost the same, never make the customer pick one to learn the price — say the price once, name the colors, give each its OWN tracked link (one link reused for every color has shipped twice). **Where they differ, ASK the color** — the client's exact rule: "if prices differ we ask them but if they don't we share the price". Asking is only pointless when the answer cannot move the number, which was the original complaint. The one exception is a color already fixed by the ad or promo (that leaf IS the preloaded product), and a color named by the customer never reaches this path at all — a color word routes the turn to `otherTopic`. Questions join the colors with **o**, statements with **y**: "¿Lo quieres en negro y blanco?" asks nothing. Equality is **computed at quote time, never written in**: 54 of the catalog's 61 same-parent-same-size sibling sets are priced alike, but 6 confeccionada sizes genuinely differ (6x4 m is $649 beige / $729 negro / $1320 verde) and the live ML listings disagree with the sheet more often than the sheet disagrees with itself. Where they differ, the quote does NOT lead with one color's number as if it were THE price. Two traps: the helper matches COLOR NAMES, because `Sujetadores > Ojillos` siblings are package sizes (10/20/…/100 piezas) with an empty `size` and would otherwise be offered as colors; and a size may have only ONE active color (confeccionada 3x3 has negro and verde `active: false`), so there is nothing to offer — the helper returns null and the old single-color sentence stands.
- **Color comes AFTER the price, never before it (2026-10-23, client's note).** Ground cover does not price by color, so making the customer pick one to learn the cost buys nothing — "¿La quieres en negro o en blanco?" was the entire reply to a price question. The cut-piece quote now prints EVERY color with its own price and link after the measure; a length with no width asks only the WIDTH (2 m or 4 m), which is what actually changes the price. **Careful with the premise:** the price SHEET treats negro and blanco as equal, but the LIVE ML listings do not (4x10 m is $690.80 negro vs $933.90 blanco; 4x25 m is *cheaper* in blanco), and live is what we quote for cut pieces — so never assert "same price for both colors" outside the full rolls. Those listing prices are the client's to reconcile.
- **No unbacked promises.** Never offer a benefit we can't guarantee — no "llámanos y te atendemos más rápido", no "últimas piezas", no invented urgency; only checkable facts (price, measure, color, stock, shipping, loaded promos). Standing guard in `setupContext.js`. NOTE: the "Llama ahora para recibir un servicio más rápido" line in the Page inbox is **Meta's own prompt, not ours** — it is in no prompt, knowledge entry, CompanyInfo or promo, and was never stored as one of our messages. Don't go hunting for it in the code.
- **A gate that answers HALF the message drops the other half (2026-10-24 audit).** "18 mts. C P 92730" — the measure he'd just chosen AND his zip — was answered "ya registré tu código postal", and the next turn re-listed all four lengths as if he'd picked nothing. `captureZipReply`'s `bareNumberOnly` (ai/index.js) thanks-and-stops without a model turn, and its stripper left "mts" — exactly the 3 characters that still counted as bare. A second number anywhere besides the CP now means the message carries another fact, so the turn continues (the CP is still captured either way). Same family as the gates-must-not-short-circuit rule: the zip ask is the one gate guaranteed to fire on a buy-intent turn, so it is the one most likely to swallow a sale.
- **The NAME is captured, never asked — and the engine couldn't see it (2026-10-24 audit, 10 of 15 flags).** The platform profile name lands on `Conversation.extractedName` (harvested in `conversationManager`), but the workflow engine only ever knew `state.lead.name`, which starts empty — so every handoff asked for "tu nombre, un teléfono y tu código postal" while the handoff brief printed the name correctly from the same document. `ai/index.js` now passes it as `opts.profileName` (validated with the same `looksLikeName` the correlation uses) and both handoff asks ask only for what's missing. It deliberately does NOT satisfy `haveContact`: a name is not reachable, the phone still has to be asked.
- **A 2-D measure is only a ROLL if it could BE one (2026-10-24 audit).** "3 × 4" on the Ground Cover ad was answered "¿el área que buscas cubrir es de 12 m²?", then "Beige" dead-ended on "aquí solo hay negro y blanco", and a "Si" two turns later bought him a quote for a 2x100 m NEGRO roll he never asked for. The rollo gate turns any non-exact measure into an area to cover, which is right for "cubrir 200 m²" and wrong for a panel. Rule: a measure whose longest side is under the shortest roll length this flow stocks (`shortestRollLength`, GC = 10 m) is a confeccionada panel, so the gate leaves the turn unclaimed and §1.5 flow-switches. The gate ran at line ~1070 and the switch at ~2750, so the gate always won. A colour ground cover doesn't have now routes too, instead of ending the conversation.
- **A length-only product's `size` is not a measure.** The borde separador's is `13x18m` — 13 CENTIMETRES of height by 18 m of length — and it reached a customer as "El precio del Rollo de 18 m (13x18m)", which reads as a 13 × 18 metre roll. The catalogue flags these by leaving `width` out of `enabledDimensions`; the promo label now uses the product's own NAME for them (it also stopped calling a borde "la malla sombra de 13x18 m"). `tools.js` already had this `lengthOnly` notion — reuse it rather than parsing the string.
- **The pending-handoff timeout was 30 SECONDS (2026-10-26, client report).** The bot asks for name/phone/CP before escalating, and `runPendingHandoffTimeoutJob` (`jobs/silenceFollowUp.js`) escalated anyway after 30s and stamped "⚠️ el cliente NO proporcionó su información de contacto". Nobody types a name, a 10-digit phone and a CP in 30 seconds, so the flag was usually a lie: **9 of the 12 handoffs** in the 2026-10-24→26 window carried it, which is what the client reported as "the bot hands off before collecting anything". Now **10 minutes** (`PENDING_HANDOFF_TIMEOUT_MS`), and the reason text derives the number from the constant instead of hardcoding "30s".
- **BOTH entry paths threw away the customer's answer after a handoff (2026-10-26, client report).** `captureLateContact` (`ai/index.js`) exists precisely to catch a late "me llamo … mi tel es …" while the bot is silent — but it sits INSIDE the engine, and both entry paths return before reaching it: the FB webhook on `isHumanActive` (`index.js`) and the WhatsApp processor on `state === 'human_active'` (`channels/unified/processor.js`). So it never ran for `human_active` at all. Argelia (psid 28756179244021826) replied 2h35m after the escalation with her name, her street address and **CP 70190**, and the conversation still had `lead {}`, no zipcode and the false "NO proporcionó" note. It is now exported and called from both returns, and it captures the **CP** too (zip + city, synced to `User.location.zipcode` for correlation) — not just name/phone, because the CP is what the asesor quotes freight from.
- **The platform profile name is NOT always the buyer.** The Messenger account was "Argelia Jiménez"; the buyer wrote "me llamo Maria Celia Fajardo jimenez". `extractedName` holds the HARVESTED profile name and both briefs preferred it, so the asesor was handed the account holder. `handoffBrief.js` / `clientBrief.js` now prefer `workflowState.lead.name` — the only field that is ever set from what the customer actually typed — and fall back to `lead.phone`/`lead.email` for the contact, because `captureLateContact` writes the engine lead, not `leadData`.
- **The cross-flow measure router is skipped inside roll flows — except when the roll flow just rejected the measure.** `routeByMeasure` (`measureRouter.js`, called ~§1.5) is deterministic and knows which flow owns a measure, but roll flows opt out of it on purpose (a roll W×L also exists as a confeccionada piece, so the router would bounce a roll customer to a clarify). That opt-out also swallowed 3x4 m on the Ground Cover ad: the turn fell to the "closest measure" gate, which offered a **4 x 10 m antimaleza roll for a 3 x 4 m shade-cloth panel**, and to the AI scope classifier, whose verdict came back "current" about half the time. `rollFlowRejectedMeasure` now lets the router run for exactly that case — 3/3 identical switches to confeccionada, while a real roll (2x50) still stays put.
- **A colour ground cover doesn't have gets a deterministic answer.** The company-wide directive to offer the way out ("beige sí existe, en malla sombra") only landed about half the time — the battery case flipped between runs. Gate (a0-ter) in the shadeless roll flow answers it directly. `áreas verdes` / `zonas verdes` is landscaping talk, not a colour request, and is stripped before matching — it is the obvious false positive in this realm.
- **The dashboard "seen" flag is a TIMESTAMP, not a boolean (2026-10-26).** `Conversation.seenAt` / `seenBy` record the moment a human opened the chat in the dashboard; a conversation reads as unseen whenever `lastMessageAt > seenAt`, so the next customer message re-arms it with no second field to keep in sync. It is **team-wide** on purpose — the inbox is shared, so one asesor opening a chat tells the others it has been looked at. Every path that opens the chat modal in `Messages.js` goes through `openConversation()` (rows, 💬 buttons, the pending-handoff queue, the `?psid=` deep link), which is what marks it; the 👁 cell toggles it back to unseen. The `seen=yes|no` filter is applied in the `/conversations/grouped` pipeline AFTER the projection, comparing the same two fields the row displays — `Conversation.lastMessageAt` is a different write path from the Message timestamps the pipeline groups, so filtering on it could disagree with the dot next to it.
- **Measure parsing (fast, no DB/LLM/network):** `node scripts/measureParseTest.js` — 21 cases over `dimsOf`/`stripMeasures`. `dimsOf` returning null means the deterministic measure gate never fires and the MODEL improvises, which is how "la de cuatro por cien" was answered "¿negro o blanco?" instead of a price: `cien` was missing from `ai/utils/spanishNumbers.js`. The percent cases are load-bearing — "cuatro por cien" is 4x100 and "cuatro por ciento" is 4 PERCENT; never add `ciento` to NUMBER_MAP.
- **Correlation health check:** `node scripts/correlationHealthCheck.js` — 17 invariants over the matches.
- **Scenario battery** (92 synthetic flow tests, LLM-graded): `node scripts/scenarioBattery.js [--group=reforzada|coldstart|…] [--smoke] [--no-judge]`.

**Testing a bot behavior end-to-end** (no server needed): drive `runWorkflowTurn(wf, initState(wf), msg, {psid, sandbox:true})` in a small `node -e` against the flow's `Workflow` doc — this is how the reported convo bugs were reproduced/verified this session.
