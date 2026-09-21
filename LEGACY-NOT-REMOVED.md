# Legacy is NOT removed — it was only disconnected

Status as of **2026-09-21**. Written because "we removed legacy" has been reported as
done at least three times and was never true.

## What actually happened

| Commit | Date | Claimed | Actually did |
|---|---|---|---|
| `f0dfd5c` | 2026-04-06 | "Remove legacy flow system; convo_flow is the only path" | changed routing only |
| `27305c0` | 2026-06-15 | "Cut the legacy tie for workflow-owned conversations" | cut a tie |
| `77ded5e` | 2026-08-25 | "Remove legacy 'Prompts de Flujos' route (/flujos)" | removed a dashboard route |

Each removed a **route** or cut a **tie**. None deleted code or config.

## Current state

Legacy **never executes**: the cold-start workflow claims every conversation
(`ai/index.js`, "FULL CUTOVER"), so nothing below that line runs. ~98% of traffic is
on the workflow engine.

But it is all still present:

- **Code (on disk, still imported):** `ai.js`, `ai/responseGenerator.js`,
  `ai/core/fallback.js`, `ai/flows/`, `ai/flowExecutor.js`,
  `ai/utils/intentDBHandler.js`, `ai/classifier/intentClassifier.js`,
  `ai/utils/promptLoader.js`, models `Intent`, `FlowPrompt`, `Flow`.
- **Config (in Mongo):** `intents` (33), `intentcategories` (6), `flowprompts` (13),
  `flows` (9), `convoflowmanifests` (9).

## Why this matters (it has burned us twice)

Answers configured in legacy look authoritative and reach **nothing**:

- The installation answer lived in `intents.installation_query` ("no contamos con
  servicio de instalación") with a passing test — the bot still escalated, because the
  engine never reads that collection.
- The delivery-time answer lived in `responseGenerator.js` (last touched Jul 22) —
  same outcome.

Both were ported into `workflow.knowledge`, which is what the engine actually reads
(`ai/workflow/nodeExecutor.js:buildSystem` → `globalPrompt` + `knowledge` + node
prompt + setup context). **Nothing else is read.**

Answers already ported: tiempo de entrega, instalación, garantía/vida útil, pago,
distribuidores, "no escales por una palabra que no entiendas", queja de calidad,
medida más cercana.

## To actually finish it

Config backup (taken 2026-09-21, before any deletion):
`legacy-backup/legacy-config-backup.json` — 78 KB, all 5 collections.

Drop the dead collections (Claude Code is blocked from dropping prod collections, so
this has to be run by a human):

```bash
cd bot-server && node -e "require('dotenv').config();const m=require('mongoose');(async()=>{await m.connect(process.env.MONGODB_URI);for(const c of ['intents','intentcategories','flowprompts','flows','convoflowmanifests']){await m.connection.db.collection(c).drop().then(()=>console.log('dropped',c)).catch(e=>console.log(c,e.message))}await m.disconnect()})()"
```

Then delete the code listed above and the dead branch in `ai/index.js` below the
cutover. Check `measureHandler.js` and `ai/utils/locationStats.js` first — they still
import `responseGenerator`.

**Do not report legacy as removed again until `ls ai/flows` fails and those
collections are gone.**
