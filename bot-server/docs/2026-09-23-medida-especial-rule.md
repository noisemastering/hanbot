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
