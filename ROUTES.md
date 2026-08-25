# HanlobBot — Route Reference & Status

Editable tracker of every dashboard route. Fill in **Status** and **Missing** as you review each one.

- **Status** — suggested values: `✅ Done` · `🟡 Partial` · `🔴 Broken` · `⚪ Not started` · `🗑️ Remove`· `👀 Review` 
- **Missing** — what's incomplete or needs work on that route

_Source: `dashboard/src/App.js` route table. Last generated: 2026-08-18._

---

## Auth & Access

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/login` | Login page | ✅ | |
| `/forgot-password` | Request a password reset | ✅ | |
| `/reset-password` | Set a new password from a reset link | ✅ | |

### Logic
Still need Google Auth and/or 2FA for a finished product


## Home

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/` | Landing — redirects to the role's home; admins see KPIs + usage gauge | 🟡 | Need checkup for Higher levels|

## Conversations & CRM

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/conversations` | Messages inbox — live chats, canned replies, sale/report tools | 🟡 | Review usability |
| `/crm` | Customer list | ✅ | |
| `/crm/:psid` | Single customer detail | ✅ | |
| `/crm/sales` | CRM sales view | ✅ | Reflects only sales attached to the system not ML overall.|
| `/reported-convos` | Review reported conversations; resolve / "sin error" | ✅ | |
| `/tickets` | Support tickets | ✅ | |
| `/notifications` | Notifications feed | ✅ |  |

## Sales, Orders & Correlation

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/conversions` | Convo↔sale correlation — attributed conversions + confidence | ✅ | Adjust criteria if needed |
| `/sales-overview` | Sales overview | ✅ | Shows all registered sales ML and Manual |
| `/manual-sales` | Manually registered sales | ✅ | |
| `/ml-orders` | Mercado Libre orders | 👀 | |
| `/ml-import` | ML order import | 👀 | |
| `/ml-importer` | ML bulk importer | 👀 | |
| `/forecast` | Sales forecast + campaign simulator | 🟡 | |
| `/pos` | Point of sale | 👀 | |

## Analytics & Ads

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/analytics` | Analytics dashboard | ✅ | |
| `/ad-performance` | Ad performance overview | ✅ | |
| `/ad-performance/:fbAdId` | Single ad detail | ✅ | |
| `/ads` | Ads list | ✅ | |
| `/adsets` | Ad sets | ✅ | |
| `/campaigns` | Campaigns | ✅ | |
| `/click-logs` | Tracked-link click logs | ✅ | |
| `/tracked-links` | Tracked links manager | ✅ | |
| `/spend-optimization` | Ad spend optimization | ❌ | Removed - Functionality relocated on ad-performance|
| `/inteligencia-artificial` | Campaign intelligence (AI) | ✅ | |
| `/segmentacion` | Customer segmentation | ✅ | |
| `/cross-sell` | Cross-sell rules | 🟡 | |

## Catalog & Products

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/inventario` | Inventory — prices, product IDs, Excel export, bulk price/link update | ✅ | |
| `/products` | Products | ✅ | |
| `/familias` | Product families | ✅ | |
| `/master-catalog` | Master catalog | ✅ | |
| `/promos` | Promotions / special offers | ✅ | |
| `/usos-grupos` | Use-case groups | 🟡 | |
| `/profiles` | Buyer profiles | 🟡 | |
| `/company-info` | Company info | ✅ | |

## Flows & AI

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/flows` | Flow prompts | 🟡 | |
| `/flujos` | Flow prompts (alias of `/flows`) | 🟡 | |
| `/workflows` | Workflow engine builder | 🟡 | |
| `/bot/simulador` | Conversation simulator | ✅ | |
| `/bot/costos-ia` | AI cost view | ✅ | |

## Playground (super_admin)

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/playground/mapa` | Mexico map — geo distribution (ML / ventas / convos / clicks) | 🟡 | |
| `/playground/conversion` | Conversion-probability explorer | 👀 | |
| `/playground/mercado-libre` | Mercado Libre playground | 👀 | |
| `/playground/rendimiento-mensajes` | Message performance | 👀 | |
| `/playground/simulador` | Conversation simulator (alias) | 👀 | |
| `/playground/anuncio-flujo` | Ad → flow mapping | 👀 | |
| `/geo` | Geo detail view |  👀 |  |

## Consumo & Billing

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/consumo` | Usage vs plan — convos/day, month total, speedometer | ✅ | |
| `/spec-ops/pago` | Mark account as paid for the month | ✅ | |

## Spec Ops (super_admin)

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/spec-ops/killswitch` | Stop the bot + maintenance modal | ✅ | |
| `/spec-ops/nuke` | Reversible hard offline lockdown | ✅ | |
| `/spec-ops/banner` | Maintenance / info banner | ✅ | |
| `/spec-ops/fb-comment-reply` | Toggle Facebook comment auto-reply | ✅ | |
| `/spec-ops/liberado` | Release gate (freeze/release flows) | ✅ | |

## Admin & Settings

| Route | What it does | Status | Missing |
|---|---|---|---|
| `/users` | User management | ✅ | |
| `/roles` | Roles & permissions | ✅ | |
| `/settings` | App settings | ✅ | |
| `/help` | Help | ✅ | |
