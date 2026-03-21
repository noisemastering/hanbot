# buyer_flow

## What it is
`bot-server/ai/flows/buyerFlow.js` — model flow that acts as a persona layer for end buyers. Does NOT handle products or sales process directly.

## Responsibilities
- Shapes tone and info presentation for other flows
- Profile adjustment: starts from manifest, adjusts based on conversation
- Reseller detection → flow_switch to reseller

## Function: `handle(userMessage, convo, psid, context)`

### Input: context
```js
{
  profile: 'casual' | 'technical'  // starting point from manifest
}
```

### Returns
- `{ type: 'flow_switch', action: 'reseller' }` — reseller intent detected
- `{ type: 'persona', profile, personaInstructions }` — persona for other flows to use

## Profiles

### casual
- Friendly, simple language, uses "tú"
- Focuses on benefits: what it's for, how it looks, easy install, colors
- For everyday customers (my house, my patio, my garage)

### technical
- Professional, precise, uses technical terminology
- Focuses on specs: shade percentage, gramaje, UV resistance, material, durability
- For contractors, installers, professionals

## Exported utilities
- `detectReseller(userMessage)` — flags reseller intent
- `evaluateProfile(userMessage, currentProfile)` — adjusts profile based on signals
- `getPersonaInstructions(profile)` — returns instruction block for AI prompts
- `PROFILES` — valid profile list

## Key rules
- It's a persona layer, not a sales flow
- Profile starts from manifest but adjusts dynamically
- Stresses product features (vs reseller which stresses investment value)
