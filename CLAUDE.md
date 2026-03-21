# Claude Code Project Notes

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
