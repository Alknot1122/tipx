# TipX — Self-Hosted Streaming Donation Platform

> **Domain:** `tip.re-codex.com` | Built with Node.js, Express, PostgreSQL, Stripe Connect, and Socket.io.

TipX is a fully self-hosted, non-custodial donation platform for streamers. It uses **Stripe Connect** to route donations directly to streamers' bank accounts, charges a minimal platform fee, and provides native OBS widget integration — completely replacing Streamlabs.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Quick Start](#quick-start)
4. [Environment Variables](#environment-variables)
5. [Database Migration](#database-migration)
6. [API Reference](#api-reference)
7. [OBS Widget Integration](#obs-widget-integration)
8. [Route Access Control (RBAC)](#route-access-control-rbac)
9. [Fee Structure](#fee-structure)
10. [Stripe Webhook Setup](#stripe-webhook-setup)
11. [Deployment (Render / Railway)](#deployment)

---

## Architecture Overview

```
tip.re-codex.com/               → 302 Redirect → re-codex.com
tip.re-codex.com/:slug          → Public donation page (no login)
tip.re-codex.com/dashboard/:slug → Streamer private dashboard (JWT auth)
tip.re-codex.com/dashboard      → Admin master dashboard (admin only)

tip.re-codex.com/public/widget/alert?token=XYZ    → OBS Alert Box
tip.re-codex.com/public/widget/progress?token=XYZ → OBS Progress Bar
```

**Real-time flow:**
```
Donor pays → Stripe → payment_intent.succeeded webhook → TipX backend
                                                              ↓
                                           PostgreSQL (donation logged)
                                                              ↓
                                        Socket.io /widget namespace
                                                              ↓
                                      OBS Browser Source (alert pops)
```

---

## Project Structure

```
tipx/
├── schema.sql                        # PostgreSQL schema (run first)
├── .env.example                      # Copy to .env and fill in values
├── package.json
└── src/
    ├── server.js                     # Express + Socket.io entry point
    ├── config/
    │   ├── db.js                     # PostgreSQL connection pool
    │   └── stripe.js                 # Stripe SDK singleton
    ├── middleware/
    │   └── auth.js                   # JWT verification + RBAC guards
    ├── utils/
    │   └── token.js                  # JWT + refresh token helpers
    ├── controllers/
    │   ├── authController.js         # Login / Refresh / Logout
    │   ├── adminController.js        # Provision streamers, master list
    │   ├── streamerController.js     # Dashboard, donations, widget config
    │   ├── publicController.js       # Public page + Payment Intent
    │   └── webhookController.js      # Stripe webhook handler
    ├── routes/
    │   ├── authRoutes.js
    │   ├── adminRoutes.js
    │   ├── streamerRoutes.js
    │   ├── publicRoutes.js           # Also serves OBS widget HTML
    │   └── webhookRoutes.js          # express.raw() for Stripe sig verify
    ├── websockets/
    │   └── widgetSocket.js           # Socket.io /widget namespace
    └── scripts/
        ├── migrate.js                # Apply schema.sql to DB
        └── seedAdmin.js              # Create the first admin account
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY, etc.

# 3. Run database migration
npm run migrate

# 4. Seed the master admin account
npm run seed:admin admin YourStrongPassword123!

# 5. Start development server
npm run dev
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon / Railway / Render) |
| `JWT_SECRET` | 64-char random secret for access tokens |
| `REFRESH_TOKEN_SECRET` | 64-char random secret for refresh tokens |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `CORS_ORIGIN` | Your frontend origin, e.g. `https://tip.re-codex.com` |
| `ROOT_REDIRECT_URL` | Where `/` redirects, e.g. `https://re-codex.com` |
| `PORT` | Server port (default: `4000`) |

---

## Database Migration

The schema is in `schema.sql`. Run it against your Neon / Railway / Render DB:

```bash
npm run migrate
# or manually:
psql $DATABASE_URL -f schema.sql
```

**Key optimizations in schema:**
- All monetary amounts stored as `INT` (satang/cents) — no floats
- `VARCHAR` limits enforced on donor names (50), messages (255), slugs (50)
- Indexes on `slug`, `stripe_account_id`, `stripe_payment_intent`, `alert_token`
- `updated_at` auto-maintained via DB trigger

---

## API Reference

### Auth — `/auth`
| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Login with username + password |
| `POST` | `/auth/refresh` | Rotate refresh token → new access token |
| `POST` | `/auth/logout` | Revoke refresh token, clear cookies |

### Admin — `/admin` *(Admin role required)*
| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/streamers` | List all streamers with donation stats |
| `POST` | `/admin/streamers` | Provision a new streamer account |
| `PATCH` | `/admin/streamers/:id/toggle` | Enable/disable a streamer |

### Streamer Dashboard — `/dashboard` *(Auth + ownership required)*
| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboard/:slug` | Dashboard data + widget settings |
| `GET` | `/dashboard/:slug/donations` | Paginated donation history |
| `POST` | `/dashboard/:slug/donations/:id/replay` | Re-trigger an alert in OBS |
| `PUT` | `/dashboard/:slug/widget` | Update alert/progress bar config |
| `GET` | `/dashboard/:slug/stripe/onboard` | Get Stripe onboarding URL |

### Public — `/:slug`
| Method | Path | Description |
|---|---|---|
| `GET` | `/:slug` | Donor page data |
| `POST` | `/:slug/payment-intent` | Create Stripe Payment Intent |
| `GET` | `/public/widget/alert?token=XYZ` | OBS Alert Box HTML |
| `GET` | `/public/widget/progress?token=XYZ` | OBS Progress Bar HTML |

### Webhooks
| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/stripe` | Stripe webhook receiver |

---

## OBS Widget Integration

1. Log into your dashboard and copy your **alert token**.
2. In OBS → Sources → Add Browser Source.
3. Set URL to:
   - **Alert Box:** `https://tip.re-codex.com/public/widget/alert?token=YOUR_TOKEN`
   - **Progress Bar:** `https://tip.re-codex.com/public/widget/progress?token=YOUR_TOKEN`
4. Set Width: `800`, Height: `200` (alert box) or `100` (progress bar).
5. Enable **"Shutdown source when not visible"** and **"Refresh when scene becomes active"**.

Widgets authenticate automatically via the token and maintain a persistent WebSocket connection. When a donation succeeds, OBS shows the alert within **~100ms**.

---

## Route Access Control (RBAC)

| Route Pattern | `admin` | `streamer` (own slug) | `streamer` (other slug) | Public |
|---|---|---|---|---|
| `/` | ✅ | ✅ | ✅ | ✅ (302 redirect) |
| `/:slug` | ✅ | ✅ | ✅ | ✅ |
| `/dashboard/:slug` | ✅ | ✅ | ❌ (404) | ❌ (401) |
| `/admin/*` | ✅ | ❌ (403) | ❌ (403) | ❌ (401) |

> **Security Note:** Unauthorized streamer slug access returns `404` (not `403`) to prevent slug enumeration attacks.

---

## Fee Structure

All amounts are in **satang** (1 THB = 100 satang).

| Fee | Rate | Who Charges |
|---|---|---|
| Stripe PromptPay | 1.65% | Stripe (automatic) |
| TipX Platform Fee | 0.50% | TipX via `application_fee_amount` |
| **Net to Streamer** | **~97.85%** | Routed directly to bank |

The platform fee is set via Stripe's `application_fee_amount` on the PaymentIntent, meaning TipX never holds funds.

---

## Stripe Webhook Setup

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server (development)
stripe listen --forward-to localhost:4000/webhooks/stripe

# Test a payment
stripe trigger payment_intent.succeeded
```

**Events handled:**
- `payment_intent.succeeded` → Log donation, update progress bar, broadcast WebSocket alert
- `account.updated` → Auto-confirm Stripe Connect onboarding completion

---

## Deployment

### Neon.tech (Recommended free DB)
1. Create project at [neon.tech](https://neon.tech)
2. Copy connection string to `DATABASE_URL`
3. `npm run migrate`

### Render (Free Tier Backend)
1. Connect your GitHub repo
2. Set **Build Command:** `npm install`
3. Set **Start Command:** `npm start`
4. Add all environment variables in Render dashboard
5. Set `NODE_ENV=production`

### Stripe Production Checklist
- [ ] Switch to `sk_live_...` and `whsec_live_...` keys
- [ ] Confirm each streamer's Stripe Express account is verified
- [ ] Set `statement_descriptor` to streamer alias in their Stripe dashboard
- [ ] Enable PromptPay in Stripe payment methods
