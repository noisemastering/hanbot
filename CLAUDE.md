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
- **Correlation health check:** `node scripts/correlationHealthCheck.js` — 17 invariants over the matches.
- **Scenario battery** (synthetic flow tests, LLM-graded): `node scripts/scenarioBattery.js [--group=reforzada|coldstart|…] [--smoke] [--no-judge]`.

**Testing a bot behavior end-to-end** (no server needed): drive `runWorkflowTurn(wf, initState(wf), msg, {psid, sandbox:true})` in a small `node -e` against the flow's `Workflow` doc — this is how the reported convo bugs were reproduced/verified this session.
