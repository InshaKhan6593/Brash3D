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
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/postgres
DATABASE_SSL_CA_FILE=certs/supabase-root-2021.crt
DATABASE_POOL_MAX=10
```

Use the **session** pooler (port 5432) for a long-running host and the
**transaction** pooler (port 6543) for a serverless one, where every concurrent
instance opens its own connection. `sslmode` in the URL is ignored: TLS comes
from `src/lib/db-ssl.mjs`, and Supabase signs its certificates with a private
root that no system trust store carries, so the CA above must be supplied.
`DATABASE_SSL_CA` carries the same PEM inline for hosts that expose only
environment values.

Then `npm run db:migrate`. The runner drops the `supabase_realtime` publication
that every Supabase project pre-creates, but only when the target database is
completely empty, so migration 001 can define it. Existing databases are never
touched. See [Specification decisions](docs/SPEC_DECISIONS.md) for the detail.

Row level security is enabled on every public table by migration 015, which is
what stops Supabase's PostgREST endpoint serving the schema to anyone holding
the publishable key. The application connects as the table owner and so is
unaffected. Supabase Auth and Realtime are still unused: staff sessions are the
app's own, and the session views poll.

## Logging

Every route handler logs unexpected failures as single-line JSON on stderr, with
credential-shaped fields redacted. Stripe webhook outcomes, automatic refunds of
late booking payments, and failed staff logins are logged explicitly.

No logging SDK is used, so any aggregator can ingest the output directly. Point
the host's log drain at it, or add an error tracker later without touching the
call sites.

## Deploying

The app is one deployable unit and the database stays on Supabase, so a
deployment is a single service. Two hosts are configured in the repository and
neither interferes with the other: Vercel ignores `railway.json`, Railway
ignores `vercel.json`.

The difference that matters is whether the host keeps a process alive:

| | Railway (persistent) | Vercel (serverless) |
| --- | --- | --- |
| `DATABASE_URL` pooler port | `5432` session | `6543` transaction |
| `DATABASE_POOL_MAX` | `10` | `1` — each instance pools separately |
| `MAINTENANCE_INTERVAL_MINUTES` | `5` — the in-process timer runs | `0` — a frozen instance never fires a timer |
| Maintenance driven by | `src/instrumentation.ts` | platform cron → `/api/maintenance` |
| CA certificate | `DATABASE_SSL_CA_FILE=certs/...` | `DATABASE_SSL_CA=<PEM>` |
| Migrations | `preDeployCommand` in `railway.json` | run `npm run db:migrate` by hand |

The certificate difference is not cosmetic. `DATABASE_SSL_CA_FILE` is read at
runtime from a path held in an environment variable, which Next cannot trace,
so the file is never bundled into a serverless function and the connection
fails. Serverless hosts must use `DATABASE_SSL_CA` with the PEM inline, and must
not set `DATABASE_SSL_CA_FILE` at all — it takes priority and throws when the
file is absent.

### Whichever host

1. Run `npm run db:migrate` against the production database.
2. Create staff accounts with `npm run auth:create-staff`. Never reuse local
   credentials.
3. Deploy, then confirm `/api/health` returns
   `{"status":"ok","database":"connected"}`. That route answers 503 when the
   database is unreachable, so it catches a bad URL or a mangled certificate
   before anyone visits the site.
4. Register `https://<domain>/api/stripe/webhook` in Stripe and subscribe to
   **`checkout.session.completed`** and **`checkout.session.expired`**. Put that
   endpoint's signing secret in `STRIPE_WEBHOOK_SECRET` and redeploy — an
   environment change does not reach a running deployment.
5. Keep `STRIPE_MODE=test` until the client signs off. Live mode has a different
   key *and* a different webhook signing secret.

Register the webhook against the **stable production domain**. A per-deployment
URL changes on every push and the webhook would break silently on the next one.

### Vercel specifics

Cron on the Hobby plan cannot run more than once a day, and a deployment
carrying a more frequent expression fails to build. `vercel.json` therefore
schedules `/api/maintenance` daily, which is enough: expired booking holds are
released inside the query that reads the slot list, so the cron is cleanup
rather than correctness. Vercel Cron calls its target with GET, which is why
that route exports both verbs behind the same bearer check, and why
`MAINTENANCE_SECRET` and `CRON_SECRET` must hold the same value.

Deployment Protection is on by default and answers every request with a redirect
to a Vercel login. Stripe cannot satisfy that, so webhooks would be rejected at
the edge before reaching the app. On Hobby the production domain is exempt and
only per-deployment URLs are protected, so use the production domain; on other
plans check the setting.

Functions default to `iad1`. Keep the Supabase project in a nearby region — a
database on another continent costs a round trip on every query, and a page
makes several.

### Before real payments

- Set `STRIPE_MODE=live` with a rotated live secret and a live webhook secret.
- Rotate every staff password created for testing.
- Move the Supabase project off the free plan, which pauses after a week of
  inactivity and takes the site down until someone resumes it by hand.
- Configure database backups, ship the JSON logs to an aggregator, and set up
  uptime monitoring.
- Add Meta WhatsApp and courier credentials only after the client selects those
  providers.

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
- **A Spanish seller/admin dashboard** — customer screens and the Colombia panel are translated; the USA dashboard is not.
- **Realtime updates** — the session views poll rather than subscribe.
