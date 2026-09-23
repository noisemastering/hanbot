Note: special-measure rule now yields to the catalog (workflow config change)

Config-only change, recorded here because it is not visible in the code.

Two node prompts carried hard escalation rules:
  cotizar   - "Si ambos lados son >= 8 metros ... es una MEDIDA ESPECIAL (request_handoff)"
  descubrir - "Si ... ambos lados son > 7 m ... debes escalar a humano"

The model applied them to measures where only ONE side is large, and escalated sizes
we stock. Reported: "10 x 5" escalated with the reason "es una medida especial (ambos
lados son mayores o iguales a 8 m)" - 5 is not >= 8. The agent then sold the 5x10
herself. Same reason appeared for 9x6. That is the bulk of the 52 "medida especial"
handoffs.

Both prompts now carry: the rule applies ONLY when the measure does not exist in
catalog - if the turn's context already has that measure with its price and link,
quote it and do not escalate - and "ambos lados" means BOTH sides at once (10 x 5
does not qualify, 5 is smaller).

Applied to Malla Sombra Confeccionada con Refuerzo (descubrir, cotizar) and Sin
Refuerzo (cotizar).

Verified: the reported sequence now quotes 5x10 at $1044 with its link on both "10 X
5" and "Son diez metros de largo por cinco de ancho", no escalation. A genuinely
oversized 12x11 still behaves - offers the closest we carry, 7x10 at $3450.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EVNqQpRQb93YUSJ5yVbfrQ

---

## Update — rule rewritten as evaluate-then-decide

The guard above stopped the damage but not the cause. Measured the cause directly by
giving the model the rule and nothing else:

| Prompt given to the model | Correct verdicts |
|---|---|
| Just the condition -> true/false | 4/4 |
| Condition **welded to its action** ("SÍ la fabricamos... pásalo con un asesor... NUNCA digas que no") | 1/4 |
| Same + asked to justify | 1/4 |

Same condition, same measures. The model can do the comparison; it stops doing it
when the condition and the action share a sentence. It pattern-matches "medida
grande -> especial -> handoff" and then writes a justification that contradicts its
own arithmetic ("uno de los lados es de 9 metros" for a rule that requires both).

The rule in `cotizar` (both malla flows) is now split into steps:

    PASO 1 (sólo comparar, sin decidir): toma los dos números y quédate con el MENOR.
            Es ESPECIAL sólo si ese MENOR es >= 8 m, o si el cliente confirma decimales.
            10 x 5 -> menor 5 -> NO.  9 x 6 -> menor 6 -> NO.  9 x 10 -> menor 9 -> SÍ.
    PASO 2 — si NO es especial: medida ESTÁNDAR, cotízala normal. No la llames especial.
    PASO 3 — si SÍ es especial: sí la fabricamos, pásalo con un asesor (request_handoff).

Re-ran the exact question format that had failed: **7/7** (10x5, 9x6, 8x4, 9x10, 8x8,
4x4, 12x3). End to end in the flow: "10 X 5" -> $1044 + link, "9x6 que vale" -> $1979
+ link, neither escalates.

Known gap: "quiero una de 9x10" (a genuine special measure) is answered by the
nearest-measure path with 7x10 at $3450 before the special-measure rule is reached,
so it never offers to make it to measure. Separate issue - a gate short-circuiting -
not the true/false problem fixed here.
