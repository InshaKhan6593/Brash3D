# Brash3D Live Shopping

Brash3D is a Next.js MVP for booking a live outlet-shopping session, managing it from a seller dashboard, and following the cart and payment progress from a customer view.

## What is included

- Customer booking from today through the end of next month.
- One-hour slots from 9:00 AM to 6:00 PM at each configured demo outlet.
- Booked slots stay visible and disabled.
- Seller dashboard with bookings, customers, compact session tables, row actions, pagination, and a notification center.
- Seller-created bookings and a live product-entry panel.
- Customer live cart, order timeline, and Stripe-backed 65/35 payment flow.
- USA seller/admin workflow for shipment-code creation, assignment to consolidated dispatch boxes, dispatch summaries with confirmation, plus a Colombia receiving manifest, final collection, and delivery confirmation.
- Spanish customer screens and Spanish Colombia local-team panel; English USA seller/admin dashboard.
- Per-box settlement summary splitting Stripe revenue (US LLC) from the Colombia local operating fund.
- Optional local Brash3D SAS invoice request, flagged through to the delivery manifest.
- Configurable `TAX_RATE_FL` and `FEE_RATE`, recorded per session at booking time.
- Per-order payment split: the seller sets how much is paid up front (100%, 85%, 65% or any figure), and the balance is collected on delivery.
- Shared shadcn/ui components with neutral light and dark themes.

## Local setup

Run everything from the `brash3d-app` directory.

```bash
npm install
docker compose up -d
cp .env.example .env.local
npm run db:migrate
npm run dev
```

`docker compose up -d` only starts PostgreSQL; `npm run db:migrate` owns the schema and tracks every applied file in `schema_migrations`.

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`. Replace the Stripe placeholders in `.env.local` directly. Never commit that file. PostgreSQL binds only to `127.0.0.1:5440`, and all numbered migrations are tracked in `supabase/migrations`.

Open [http://localhost:3000](http://localhost:3000). The seller dashboard is available at [http://localhost:3000/seller](http://localhost:3000/seller).

Create the first staff administrator after migrating the database:

```bash
npm run auth:create-staff -- admin@example.com "Use-A-Strong-Password-42!" admin "Administrator Name"
```

The same command creates the other two roles. A `seller` account's email must match an active row in `vendedores` (`maria@brash3d.com`), and a `local_team` account's email must match a row in `equipos_locales` (`colombia@brash3d.com`):

```bash
npm run auth:create-staff -- maria@brash3d.com "<password>" seller "Maria Garcia"
npm run auth:create-staff -- colombia@brash3d.com "<password>" local_team "Equipo Colombia"
```

Roles are scoped on the server: a seller sees only their own sessions, a local-team
account reaches only `/local-team`, and an admin reaches both. Never commit these
passwords or reuse development credentials in production.

Staff sign in at [http://localhost:3000/login](http://localhost:3000/login). Customer order links exchange a secure URL token for a scoped HTTP-only cookie and do not require customer passwords.

For Stripe Test Mode, keep `STRIPE_MODE=test`, place rotated test keys in `.env.local`, run `stripe login`, and keep this command running in a second terminal:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the CLI's `whsec_...` signing secret directly into `.env.local` and restart the app. Stripe events reach localhost through this authenticated forwarding connection.

At production launch, explicitly set `STRIPE_MODE=live` and use only matching `sk_live_` credentials. The server rejects a key whose mode does not match this setting.

## Quality checks

```bash
npm run lint
npm test
npm run build
```

`npm test` needs PostgreSQL running (`docker compose up -d` and `npm run db:migrate`).
The invoice and payment-split logic is SQL, so those tests run against a real
database and clean up after themselves.

With the development server also running on port 3000:

```bash
npm run test:smoke
node scripts/referral-smoke-test.mjs
node scripts/referral-webhook-smoke-test.mjs
```

Each script removes the records it creates. See [Implementation status](docs/IMPLEMENTATION_STATUS.md) for what is still outstanding.

## Hosting the database on Supabase

The schema and migrations run on Supabase unchanged. Point `DATABASE_URL` at the
project's pooler endpoint and request TLS:

```
DATABASE_URL=postgresql://<user>:<password>@<host>:6543/postgres?sslmode=verify-full
DATABASE_POOL_MAX=5
```

Then `npm run db:migrate`. The runner drops the `supabase_realtime` publication
that every Supabase project pre-creates, but only when the target database is
completely empty, so migration 001 can define it. Existing databases are never
touched. See [Specification decisions](docs/SPEC_DECISIONS.md) for the detail.

Supabase Auth, RLS, and Realtime are not wired up yet; see the same document.

## Logging

Every route handler logs unexpected failures as single-line JSON on stderr, with
credential-shaped fields redacted. Stripe webhook outcomes, automatic refunds of
late booking payments, and failed staff logins are logged explicitly.

No logging SDK is used, so any aggregator can ingest the output directly. Point
the host's log drain at it, or add an error tracker later without touching the
call sites.

## Production deployment

- Use a managed PostgreSQL database and run `npm run db:migrate` during deployment.
- Set `STRIPE_MODE=live` with a rotated live secret and production webhook signing secret.
- Register the public HTTPS endpoint `/api/stripe/webhook` in Stripe.
- Create unique staff accounts with strong passwords; do not reuse local credentials.
- Run behind HTTPS so secure authentication cookies are enforced.
- Configure database backups, ship the JSON logs to an aggregator, and set up uptime monitoring.
- Terminate TLS in front of the app: the auth cookies are `secure` in production and `Strict-Transport-Security` is sent on every response.
- Add Meta WhatsApp and courier credentials only after the client selects those providers.

## Documentation

- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Specification decisions](docs/SPEC_DECISIONS.md) — where the build differs from the client's spec, and why
- [WhatsApp integration plan](docs/WHATSAPP.md) — messaging rules, cost, and options
- [Architecture](docs/ARCHITECTURE.md)
- [Testing guide](docs/TESTING.md)

## What is not built yet

Everything below is tracked in detail in [Implementation status](docs/IMPLEMENTATION_STATUS.md).

- **WhatsApp Cloud API notifications** — see [the plan](docs/WHATSAPP.md); a no-template, no-cost path exists that needs nothing from the client.
- **Automatic courier tracking** — needs the client's chosen carrier and API. USA operations types the courier and tracking number today.
- **An automated test suite** — the invoice and payment-split maths are covered only by the smoke scripts above.
- **A Spanish seller/admin dashboard** — customer screens and the Colombia panel are translated; the USA dashboard is not.
- **Realtime updates** — the session views poll rather than subscribe.
